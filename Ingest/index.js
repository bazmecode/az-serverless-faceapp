const { TableClient, AzureSASCredential } = require("@azure/data-tables");
const { QueueServiceClient } = require("@azure/storage-queue");
const { v4: uuidv4 } = require("uuid");

// constants
const customer_table = "customers";
const identification_queue = "identification";

// environment variables
const account = process.env["AccountName"];
const sas = process.env["SASToken"];

module.exports = async function (context, myBlob) {
  // blob event capture
  context.log("\n\n");
  context.log("========INGEST FUNCTION========");
  context.log(
    "New blob available for processing \n Blob:",
    context.bindingData.blobTrigger,
    "\n Blob Size:",
    myBlob.length,
    "Bytes"
  );

  context.log("Adding new entry in customers table");
  const blobUri = context.bindingData.uri;

  try {
    // create an entry in customers table
    const customerTblClient = new TableClient(
      `https://${account}.table.core.windows.net`,
      customer_table,
      new AzureSASCredential(sas)
    );

    const id = uuidv4();
    context.log("Creating customer with id: " + id);
    const customerEntity = {
      partitionKey: "codershq_faces",
      rowKey: id,
      blobUri: blobUri,
      identificationComplete: false,
      personId: "",
    };
    await customerTblClient.createEntity(customerEntity);
    context.log("Customer created successfully with id: " + id);

    // add a message on face queue
    context.log("Adding new message on identification queue message: " + id);
    const queueServiceClient = new QueueServiceClient(
      `https://${account}.queue.core.windows.net${sas}`
    );

    const identificationQueue =
      queueServiceClient.getQueueClient(identification_queue);
    const sendMessageResponse = await identificationQueue.sendMessage(
      Buffer.from(id).toString("base64")
    );
    context.log(
      `Sent message successfully, service assigned message Id: ${sendMessageResponse.messageId}, service assigned request Id: ${sendMessageResponse.requestId}`
    );
  } catch (e) {
    context.log("Ingest exception:");
    context.log(e);
  }
};
