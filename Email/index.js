const sgMail = require("@sendgrid/mail");
const { TableClient, AzureSASCredential } = require("@azure/data-tables");

// constants
const duplicate_table = "duplicates";

// environment variables
const toEmail = process.env.TO_EMAIL;
const fromEmail = process.env.FROM_EMAIL;
const account = process.env["AccountName"];
const sas = process.env["SASToken"];

// sendgrid email service init
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

module.exports = async function (context, queueMessage) {
  context.log("\n\n");
  context.log("========EMAIL FUNCTION========");
  const data = queueMessage.split("|");
  const customerId = data[0];
  const duplicateId = data[1];
  context.log(
    "New message available on notification queue for processing:",
    customerId
  );

  // get duplicate details - duplicateOfCustomer, confidence
  context.log(
    "Find duplicate entity in duplicates table by customerId: " + customerId
  );
  const duplicateTblClient = new TableClient(
    `https://${account}.table.core.windows.net`,
    duplicate_table,
    new AzureSASCredential(sas)
  );
  const duplicateEntity = await duplicateTblClient.getEntity(
    customerId,
    duplicateId
  );

  if (!duplicateEntity || !duplicateEntity.rowKey) {
    context.log("Duplicate entity not found");
    return;
  }

  context.log("Duplicate entity found:");
  context.log(duplicateEntity);

  // draft email
  context.log("Preparing email");
  const emailContent = {
    to: toEmail,
    from: fromEmail,
    subject: "ServerlessFaceApp - Duplicate customer found!",
    html:
      `Hi, <br/><br/>` +
      `CustomerId <strong>${customerId}</strong> is a duplicate of CustomerId <strong>${duplicateEntity.duplicateOfCustomer}</strong> with ` +
      `a confidence score of:<strong>${duplicateEntity.confidence}</strong>` +
      `<br/><br/>Thanks,`,
  };
  context.log("Email content: " + JSON.stringify(emailContent));

  // send email
  context.log("Sending email");
  const sgResponse = await sgMail.send(emailContent);
  context.log("Email sent successfully");
  context.log(sgResponse);
};
