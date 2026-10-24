// Fixed test data embedded in the collection (generated once, kept constant so the
// collection JSON does not change on every build).

// One-page text PDF ("CV KIEM THU POSTMAN", skills Nodejs/Reactjs/JS/SQL/Docker) that
// pdf.js-extract can read, so recruiter CV lists compute a real skill match.
export const CV_PDF_DATA_URL = 'data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAyMzAgPj4Kc3RyZWFtCkJUIC9GMSAxNCBUZiA1MCA3ODAgVGQgKENWIEtJRU0gVEhVIFBPU1RNQU4gLSBKb2JGaW5kKSBUaiAwIC0yMiBUZCAoS3kgbmFuZzogTm9kZWpzLCBSZWFjdGpzLCBKUywgU1FMLCBEb2NrZXIpIFRqIDAgLTIyIFRkIChLaW5oIG5naGllbTogMiBuYW0gcGhhdCB0cmllbiB3ZWIpIFRqIDAgLTIyIFRkIChIbyBzbyBnaWEgbGFwIGNobyBibyB0ZXN0LCBraG9uZyBwaGFpIHVuZyB2aWVuIHRoYXQpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwNTIyIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNTkyCiUlRU9GCg==';

// A valid P-256 public key + 16-byte auth secret for a Web Push subscription. The
// endpoint is a non-existent FCM device, so no browser ever receives anything.
export const PUSH_SUBSCRIPTION = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/postman-jobfind-test-device',
    keys: { p256dh: 'BAuWR2b3UfEcjSv_YDLyFuZ_nL8tyhWtXxJkcy5BwL5uVdk4EKhfVCqHGrFqLvGTGVS7GHKdEeRfKZ0o5OfuFko', auth: 'oe_rrcxeMIB1tyoe6O4PMA' }
};
