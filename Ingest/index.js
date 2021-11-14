const { TableClient, AzureSASCredential } = require("@azure/data-tables");
const { QueueServiceClient } = require("@azure/storage-queue");
const { uuid } = require("uuidv4");
const person_table = "persons";
const identification_queue = "identification";
const account = process.env["AccountName"];
const sas = process.env["SASToken"];

module.exports = async function (context, myBlob) {
  // blob event capture
  context.log(
    "JavaScript blob trigger function processed blob \n Blob:",
    context.bindingData.blobTrigger,
    "\n Blob Size:",
    myBlob.length,
    "Bytes"
  );

  context.log("Adding person");

  //addPerson(context, context.bindingData.blobTrigger.replace(/\//g, ''), context.bindingData.uri);
  //const blobName = context.bindingData.blobTrigger.replace(/\//g, '');
  const blobUri = context.bindingData.uri;

  try {
    // create an entry in persons table
    const personTblClient = new TableClient(
      `https://${account}.table.core.windows.net`,
      person_table,
      new AzureSASCredential(sas)
    );

    const personId = uuid();
    const personEntity = {
      partitionKey: "coderhq_faces",
      rowKey: personId,
      BlobUri: blobUri,
    };
    personTblClient.createEntity(personEntity);
    context.log("Person added successfully");

    // add a message on face queue
    const queueServiceClient = new QueueServiceClient(
      `https://${account}.queue.core.windows.net${sas}`
    );

    const identificationQueue =
      queueServiceClient.getQueueClient(identification_queue);
    const sendMessageResponse = await identificationQueue.sendMessage(personId);
    console.log(
      `Sent message successfully, service assigned message Id: ${sendMessageResponse.messageId}, service assigned request Id: ${sendMessageResponse.requestId}`
    );
  } catch (e) {
    context.log("addPerson exception:");
    context.log(e);
  }
};
