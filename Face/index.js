const {
  odata,
  TableClient,
  AzureSASCredential,
} = require("@azure/data-tables");
const { QueueServiceClient } = require("@azure/storage-queue");
const { FaceClient, FaceModels } = require("@azure/cognitiveservices-face");
const { CognitiveServicesCredentials } = require("@azure/ms-rest-azure-js");
const { v4: uuidv4 } = require("uuid");

// constants
const customer_table = "customers";
const duplicate_table = "duplicates";
const notification_queue = "notification";
const personGroupId = "codershq_faces";

// environment variables
const account = process.env["AccountName"];
const sas = process.env["SASToken"];
const faceKey = process.env["FaceKey"];
const faceEndPoint = process.env["FaceEndPoint"];
const identificationThreshold = process.env["IdentificationThreshold"];

// face service init
const cognitiveServiceCredentials = new CognitiveServicesCredentials(faceKey);
const faceClient = new FaceClient(cognitiveServiceCredentials, faceEndPoint);

module.exports = async function (context, customerId) {
  context.log("\n\n");
  context.log("========FACE FUNCTION========");
  context.log(
    "New message available on identifications queue for processing:",
    customerId
  );

  try {
    // lookup customer by customerId and get blob uri
    context.log(
      "Find customer in customers table by customerId: " + customerId
    );
    const customerTblClient = new TableClient(
      `https://${account}.table.core.windows.net`,
      customer_table,
      new AzureSASCredential(sas)
    );
    const customer = await customerTblClient.getEntity(
      "codershq_faces",
      customerId
    );
    context.log("Customer found:");
    context.log(customer);

    const options = {
      returnFaceLandmarks: true,
      detectionModel: "detection_03",
      recognitionModel: "recognition_04",
    };

    // detect face in blob image
    context.log("Detecting face in image: " + customer.blobUri);
    const faceDetectResult = await faceClient.face.detectWithUrl(
      customer.blobUri + sas,
      options
    );
    context.log("Face detection result: " + JSON.stringify(faceDetectResult));

    if (
      faceDetectResult &&
      faceDetectResult.length > 0 &&
      faceDetectResult[0].faceId
    ) {
      context.log(
        "Face detected successfully faceId: " + faceDetectResult[0].faceId
      );
    } else {
      // end process if no face detected
      context.log("No face detected");
      return;
    }

    // Get or Create PersonGroup
    const faceIds = [faceDetectResult[0].faceId];
    const personGroupCreated = await getOrCreatePersonGroup(context);

    let identificationResult = {};
    // No need to perform identification if person group is newly created
    if (!personGroupCreated) {
      // identify
      context.log("Identifying faceIds: " + faceIds);
      identificationResult = await faceClient.face.identify(faceIds, {
        personGroupId: personGroupId,
      });
      context.log("Identification results:");
      context.log(JSON.stringify(identificationResult));
    }

    // update identification status
    customer.identificationComplete = true;
    await customerTblClient.updateEntity(customer);

    // check identification result if duplicate was found
    if (
      identificationResult &&
      identificationResult.length > 0 &&
      identificationResult[0].candidates.length > 0 &&
      identificationResult[0].candidates[0].personId &&
      identificationResult[0].candidates[0].confidence >=
        identificationThreshold
    ) {
      // duplicate found
      const duplicateOfPersonId =
        identificationResult[0].candidates[0].personId;
      const confidence = identificationResult[0].candidates[0].confidence;
      context.log("Duplicate found personId: " + duplicateOfPersonId);

      // get existing customer details, whose duplicate was found
      const customerByPersonIdList = await customerTblClient.listEntities({
        queryOptions: { filter: odata`personId eq ${duplicateOfPersonId}` },
      });
      const duplicateOfCustomer = await (
        await customerByPersonIdList.next()
      ).value;
      if (!duplicateOfCustomer || !duplicateOfCustomer.rowKey) {
        // person details not found, stop
        context.log("Duplicate person details not found.");
        return;
      }

      // create a new entry in duplicates table
      const duplicateTblClient = new TableClient(
        `https://${account}.table.core.windows.net`,
        duplicate_table,
        new AzureSASCredential(sas)
      );

      const id = uuidv4();
      context.log("Creating duplicate entity with id: " + id);
      const duplicateEntity = {
        partitionKey: customer.rowKey,
        rowKey: id,
        duplicateOfCustomer: duplicateOfCustomer.rowKey,
        confidence: confidence,
      };
      await duplicateTblClient.createEntity(duplicateEntity);
      context.log("Duplicate entity created successfully with id: " + id);

      // add a new message on notifications queue
      context.log("Adding new message on notification queue message: " + id);
      const queueServiceClient = new QueueServiceClient(
        `https://${account}.queue.core.windows.net${sas}`
      );
      const notificationQueue =
        queueServiceClient.getQueueClient(notification_queue);
      const sendMessageResponse = await notificationQueue.sendMessage(
        Buffer.from(customer.rowKey).toString("base64")
      );
      context.log(
        `Sent message successfully, service assigned message Id: ${sendMessageResponse.messageId}, service assigned request Id: ${sendMessageResponse.requestId}`
      );
    } else {
      // duplicate not found, create new person
      // Create PersonGroup person
      context.log("Creating a person with name: " + customerId);
      let personGroupPerson = await faceClient.personGroupPerson.create(
        personGroupId,
        {
          name: customerId,
        }
      );
      context.log(
        "Person created successfully personId: " + personGroupPerson.personId
      );
      customer.personId = personGroupPerson.personId;
      await customerTblClient.updateEntity(customer);
      context.log("Update person entity");

      // add face to person
      context.log("Add face to person");
      await faceClient.personGroupPerson.addFaceFromUrl(
        personGroupId,
        personGroupPerson.personId,
        customer.blobUri + sas
      );
      context.log("Person face added successfully");

      // train
      context.log("Training person group: " + personGroupId);
      await faceClient.personGroup.train(personGroupId);

      // wait for training to complete
      await waitForTraining(context);
      context.log("Training completed");
    }
  } catch (e) {
    context.log("Face exception:");
    context.log(e);
  }
};

async function getOrCreatePersonGroup(context) {
  let personGroupCreated = false;
  let personGroupExists = false;
  try {
    let personGroup = await faceClient.personGroup.get(personGroupId);
    if (personGroup && personGroup.personGroupId) {
      personGroupExists = true;
      context.log("Person group exists with ID: " + personGroupId);
    }
  } catch (e) {
    context.log("PersonGroup exception:");
    context.log(e);
  } finally {
    if (!personGroupExists) {
      // create person group
      context.log("Creating a person group with ID: " + personGroupId);
      await faceClient.personGroup.create(personGroupId, {
        name: personGroupId,
        recognitionModel: "recognition_04",
      });
      personGroupCreated = true;
      context.log("Person group created successfully");
    }
  }
  return personGroupCreated;
}

async function waitForTraining(context) {
  // Wait so we do not exceed rate limits.
  context.log("Waiting 10 seconds...");
  await sleep(10000);
  let result = await faceClient.personGroup.getTrainingStatus(personGroupId);
  context.log("Training status: " + result.status + ".");
  if (result.status !== "succeeded") {
    await waitForTraining(context);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
