# serverless-faceapp
## Serverless Face Recognition App

#### A serverless function which leverages Azure Cognitive Services’ face recognition capabilities to identify duplicate customers using their face and send an email notification.
<br/>

#### Process:
1. User uploads face image on the blob storage
2. Blob storage triggers an event for ingest function
3. Ingest function creates an entry in the table storage and adds a message on the identification queue
4. A new message on identification queue triggers the face function
5. Face function performs face detection, adds the face to the group, trains and performs identification. If a duplicate face is found, then it creates an entry on table storage and adds a message on the notification queue 
6. A new message on notification queue triggers the email function
7. Email function sends an email that a duplicate face has been found
