import './style.css';

import firebase from 'firebase/app';
import 'firebase/firestore';

const firebaseConfig = {

};


if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const firestore = firebase.firestore();

const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};

// Global State
const pc = new RTCPeerConnection(servers);

const callButton = document.getElementById('host-connection');
const callInput = document.getElementById('host-connection-id');
const answerInput = document.getElementById("text-input");
const answerButton = document.getElementById('add-connection');
const fileInput = document.getElementById('file-input');
const fileButton = document.getElementById('send-file');
let dc;

// 2. Create an offer
callButton.onclick = async () => {
  dc = pc.createDataChannel("channel");

  // Reference Firestore collections for signaling
  const callDoc = firestore.collection('calls').doc();
  const offerCandidates = callDoc.collection('offerCandidates');
  const answerCandidates = callDoc.collection('answerCandidates');

  callInput.innerHTML = "Copied to clipboard";
  answerInput.value = callDoc.id;
  navigator.clipboard.writeText(callDoc.id);

  // Get candidates for caller, save to db
  pc.onicecandidate = (event) => {
    console.log(event.candidate, "offer")
    event.candidate && offerCandidates.add(event.candidate.toJSON());
  };

  // Create offer
  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };

  await callDoc.set({ offer });

  // Listen for remote answer
  callDoc.onSnapshot((snapshot) => {
    const data = snapshot.data();
    if (!pc.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      pc.setRemoteDescription(answerDescription);
    }
  });

  // When answered, add candidate to peer connection
  answerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data());
        pc.addIceCandidate(candidate);
      }
    });
  });
  pc.ondatachannel = (event) => recieveFile(event);
};

// 3. Answer the call with the unique ID
answerButton.onclick = async () => {
  const callId = answerInput.value;
  console.log(callId)
  const callDoc = firestore.collection('calls').doc(callId);
  const answerCandidates = callDoc.collection('answerCandidates');
  const offerCandidates = callDoc.collection('offerCandidates');

  pc.onicecandidate = (event) => {
    console.log(event.candidate, "answer")
    event.candidate && answerCandidates.add(event.candidate.toJSON());
  };

  const callData = (await callDoc.get()).data();

  const offerDescription = callData.offer;
  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
  };

  await callDoc.update({ answer });

  offerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      console.log(change);
      if (change.type === 'added') {
        let data = change.doc.data();
        pc.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });

  pc.ondatachannel = (event) => recieveFile(event);
};

var fileReader;

fileButton.onclick = async () => {
  const file = fileInput.files[0];
  const chunkSize = 16384;
  fileReader = new FileReader();
  let offset = 0;
  fileReader.addEventListener('error', error => console.error('Error reading file:', error));
  fileReader.addEventListener('abort', event => console.log('File reading aborted:', event));
  fileReader.addEventListener('load', e => {
    console.log('FileRead.onload ', e);
    if(!dc) {
      dc = pc.createDataChannel("channel");
    }
    if(offset === 0) {
      dc.send(JSON.stringify({
        type: 'file',
        name: file.name,
        size: file.size,
      }));
    }
    dc.send(e.target.result);
    offset += e.target.result.byteLength;
    if (offset < file.size) {
      readSlice(offset);
    }
  });
  const readSlice = o => {
    console.log('readSlice ', o);
    const slice = file.slice(offset, o + chunkSize);
    fileReader.readAsArrayBuffer(slice);
  };
  readSlice(0);
};

function recieveFile(event) {
  const receiveChannel = event.channel;
  let received = [];
  let fileMetaData = {};
  let offset = 0, start = true;
  receiveChannel.onmessage = (event) => {
    if(start) {
      fileMetaData = JSON.parse(event.data);
      start = false;
      return;
    }

    received.push(event.data);
    offset += event.data.byteLength;
    if (offset === fileMetaData.size) {
      const file = new Blob(received);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(file);
      link.download = fileMetaData.name;
      link.click();
      received = [];
      fileMetaData = {};
      offset = 0; 
      start = true;
    }
  };

  receiveChannel.onopen = () => {
    console.log("Data channel is open and ready to be used.");
  };
}