let participants;
let audioDeviceId;
let videoResolution = true;

//Get our url
const href = new URL(window.location.href);
//Get id
const roomId = href.searchParams.get("roomId");
//Get name
const name = href.searchParams.get("name");
//Get key
const key = href.searchParams.get("key");
//Get video
const nopublish = href.searchParams.has("nopublish");
//Get ws url from navigaro url
const url = "wss://"+href.host;
//Check support for insertabe media streams
const supportsInsertableStreams = true;//!!RTCRtpSender.prototype.createEncodedVideoStreams;
const tm = null;
const pc = null;
const ws = null;
const oldVideoTrack = null;
let _this = this;

if (href.searchParams.has ("video"))
	switch (href.searchParams.get ("video").toLowerCase ())
	{
		case "1080p":
			videoResolution = {
				width: {min: 1920, max: 1920},
				height: {min: 1080, max: 1080},
			};
			break;
		case "720p":
			videoResolution = {
				width: {min: 1280, max: 1280},
				height: {min: 720, max: 720},
			};
			break;
		case "576p":
			videoResolution = {
				width: {min: 720, max: 720},
				height: {min: 576, max: 576},
			};
			break;
		case "480p":
			videoResolution = {
				width: {min: 640, max: 640},
				height: {min: 480, max: 480},
			};
			break;
		case "320p":
			videoResolution = {
				width: {min: 320, max: 320},
				height: {min: 240, max: 240},
			};
			break;
		case "no":
			videoResolution = false;
			break;
	}


function addRemoteTrack(event)
{
	console.log(event);
	
	const track	= event.track;
	const stream	= event.streams[0];
	
	if (!stream)
		return console.log("addRemoteTrack() no stream")
	
	//Check if video is already present
	let video = container.querySelector("video[id='"+stream.id+"']");
	
	//Check if already present
	if (video){
		video.pause();
		//Ignore
		if (typeof video.srcObject === 'object') {
			video.srcObject = null;
		} else {
			video.src = '';
		}
		if (typeof video.srcObject === 'object') {
			video.srcObject = stream;
		} else {
			video.src = window.URL.createObjectURL(stream);
		}
		//Set other properties
		video.play();
		return console.log("addRemoteTrack() video already present for "+stream.id);
	}
	
	//Listen for end event
	track.onended=(event)=>{
		console.log(event);
	
		//Check if video is already present
		let video = container.querySelector("video[id='"+stream.id+"']");

		//Check if already present
		if (!video)
			//Ignore
			return console.log("removeRemoteTrack() video not present for "+stream.id);

		container.removeChild(video);
	}
	
	//Create new video element
	video = document.createElement("video");
	//Set same id
	video.id = stream.id;
	//Set src stream
	video.srcObject = stream;
	//Set other properties
	video.autoplay = true;
	video.play();
	//Append it
	container.appendChild(video);
}
	
function addLocalVideoForStream(stream,muted)
{
	//Create new video element
	const video = document.createElement("video");
	//Set same id
	video.id = stream.id;
	//Set src stream
	video.srcObject = stream;
	//Set other properties
	video.autoplay = true;
	video.muted = muted;
	video.play();
	//Append it
	container.appendChild(video);
}

async function connect(url,roomId,name,secret) 
{
	this.pc = new RTCPeerConnection({
		bundlePolicy				: "max-bundle",
		rtcpMuxPolicy				: "require",
	});
	
	//Create room url
	const roomUrl = url +"?id="+roomId;
		
	this.ws = new WebSocket(roomUrl);
	this.tm = new TransactionManager(this.ws);
	
	this.pc.ontrack = (event) => {
		addRemoteTrack(event);
	};
	
	this.ws.onopen = async function()
	{
		try
		{
			if (!nopublish)
			{
				_this.stream = await navigator.mediaDevices.getUserMedia({
					audio: {
						deviceId: audioDeviceId
					},
					video: videoResolution
				});

				//Play it
				addLocalVideoForStream(_this.stream,true);
				//Add stream to peer connection
				for (const track of _this.stream.getTracks())
				{
					//Add track
					const sender = _this.pc.addTrack(track,_this.stream);
					_this.oldVideoTrack = track.kind == "video" ? sender:null;
  				}
			 }
			
			//Create new offer
			const offer = await _this.pc.createOffer({
				offerToReceiveAudio: true,
				offerToReceiveVideo: true
			});

			console.debug("pc::createOffer sucess",offer);

			//Set it
			_this.pc.setLocalDescription(offer);

			console.log("pc::setLocalDescription succes",offer.sdp);
			
			//Join room
			const joined = await _this.tm.cmd("join",{
				name	: name,
				sdp	: offer.sdp
			});
			
			console.log("cmd::join success",joined);
			
			//Create answer
			const answer = new RTCSessionDescription({
				type	:'answer',
				sdp	: joined.sdp
			});
			
			//Set it
			await _this.pc.setRemoteDescription(answer);
			
			console.log("pc::setRemoteDescription succes",answer.sdp);
			
			console.log("JOINED");
		} catch (error) {
			console.error("Error",error);
			_this.ws.close();
		}
	};
	
	this.tm.on("cmd",async function(cmd) {
		console.log("ts::cmd",cmd);
		
		switch (cmd.name)
		{
			case "update" :
				try
				{
					//console.log(cmd.data.sdp);
					
					//Create new offer
					const offer = new RTCSessionDescription({
						type : 'offer',
						sdp  : cmd.data.sdp
					});
					
					//Set offer
					await _this.pc.setRemoteDescription(offer);
					
					//console.log("pc::setRemoteDescription succes",offer.sdp);
					
					//Create answer
					const answer = await _this.pc.createAnswer();
					
					//console.log("pc::createAnswer succes",answer.sdp);
					
					//Only set it locally
					await _this.pc.setLocalDescription(answer);
					
					//console.log("pc::setLocalDescription succes",answer.sdp);
					
					//accept
					cmd.accept({sdp:answer.sdp});
					
				} catch (error) {
					console.error("Error",error);
					_this.ws.close();
				}
				break;
		}
	});
	
	_this.tm.on("event",async function(event) {
		console.log("ts::event",event);
		
		switch (event.name)
		{
			case "participants" :
				//update participant list
				participants = event.participants;
				break;	
		}
	});
}

navigator.mediaDevices.getUserMedia({
	audio: true,
	video: false
})
.then(function(stream){	

	//Set the input value
	audio_devices.value = stream.getAudioTracks()[0].label;
	
	//Get the select
	var menu = document.getElementById("audio_devices_menu");
	
	//Populate the device lists
	navigator.mediaDevices.enumerateDevices()
		.then(function(devices) {
			//For each one
			devices.forEach(function(device) 
			{
				//It is a mic?
				if (device.kind==="audioinput")
				{
					//Create menu item
					var li = document.createElement("li");
					//Populate
					li.dataset["val"] = device.deviceId;	
					li.innerText = device.label;
					li.className = "mdl-menu__item";
					
					//Add listener
					li.addEventListener('click', function() {
						//Close previous
						stream.getAudioTracks()[0].stop();
						//Store device id
						audioDeviceId = device.deviceId
						//Get stream for the device
						navigator.mediaDevices.getUserMedia({
							audio: {
								deviceId: device.deviceId
							},
							video: false
						})
						.then(function(stream){	
							//Store it
							soundMeter.connectToSource(stream).then(draw);
						});
	
					});
					//Append
					menu.appendChild (li);
				}
			});
			//Upgrade
			getmdlSelect.init('.getmdl-select');
		        componentHandler.upgradeDom();
		})
		.catch(function(error){
			console.log(error);
		});
	
	var fps = 20;
	var now;
	var then = Date.now();
	var interval = 1000/fps;
	var delta;
	var drawTimer;
	var soundMeter = new SoundMeter(window);
	//Stop
	cancelAnimationFrame(drawTimer);

	function draw() {
		drawTimer = requestAnimationFrame(draw);

		now = Date.now();
		delta = now - then;

		if (delta > interval) {
			then = now ;
			var tot = Math.min(100,(soundMeter.instant*200));
			//Get all 
			const voometers = document.querySelectorAll (".voometer");
			//Set new size
			for (let i=0;i<voometers.length;++i)
				voometers[i].style.width = (Math.floor(tot/5)*5) + "%";
		}
	
	}
	soundMeter.connectToSource(stream).then(draw);
	
	var dialog = document.querySelector('dialog');
	dialog.showModal();
	if (!supportsInsertableStreams)
		dialog.querySelector('#key').parentElement.innerHTML = "<red>Your browser does not support insertable streams<red>";
	if (roomId)
	{
		dialog.querySelector('#roomId').parentElement.MaterialTextfield.change(roomId);
		supportsInsertableStreams && dialog.querySelector('#key').parentElement.MaterialTextfield.change(key);
		dialog.querySelector('#name').focus();
	}
	dialog.querySelector('#random').addEventListener('click', function() {
		dialog.querySelector('#roomId').parentElement.MaterialTextfield.change(Math.random().toString(36).substring(7));
		dialog.querySelector('#name').parentElement.MaterialTextfield.change(Math.random().toString(36).substring(7));
		dialog.querySelector('#key').parentElement.MaterialTextfield.change(Math.random().toString(36).substring(7));
	});
	dialog.querySelector('form').addEventListener('submit', function(event) {
		dialog.close();
		var a = document.querySelector(".room-info a");
		a.target = "_blank";
		a.href = "?roomId="+this.roomId.value;
		if (this.key.value)
			a.href += "&key="+encodeURI(this.key.value);
		a.innerText = this.roomId.value;
		a.parentElement.style.opacity = 1;
		connect(url, this.roomId.value, this.name.value,this.key.value);
		event.preventDefault();

		document.querySelector('.room-header #unmuteVideo').addEventListener('click', async function() {
			try{
				const getVideoMedia = await navigator.mediaDevices.getUserMedia({
				  video: {width: {exact: 320}, height: {exact: 240}}
				});
				const videoTracks = getVideoMedia.getVideoTracks();
				_this.stream.addTrack(videoTracks[0]);
				_this.oldVideoTrack = _this.pc.addTrack(videoTracks[0], _this.stream);

				const offer = await _this.pc.createOffer();
		  
				await _this.pc.setLocalDescription(offer);
				
				//Join room
				const joined = await _this.tm.cmd("startVideo",{
				  name	: name,
				  sdp	: offer.sdp
				});
		  
				const answer = new RTCSessionDescription({
				  type	:'answer',
				  sdp	: joined.sdp
				});
				
				//Set it
				await _this.pc.setRemoteDescription(answer);
				document.getElementById('unmuteVideo').style.display = 'none';
				document.getElementById('muteVideo').style.display = 'block';
			  }catch(error){
				console.log(error)
			  }
		});
		
		document.querySelector('.room-header #muteVideo').addEventListener('click', async function () {
			try{
				let videoStream = _this.stream.getVideoTracks();
				for(let eachstream of videoStream){
					_this.stream.removeTrack(eachstream)
				  	eachstream.stop();
				}
				console.log(_this.oldVideoTrack)
				_this.pc.removeTrack(_this.oldVideoTrack);
				const offer = await _this.pc.createOffer();
		  
				await _this.pc.setLocalDescription(offer);
				
				//Join room
				const joined = await _this.tm.cmd("stopVideo",{
				  name	: name,
				  sdp	: offer.sdp
				});
		  
				const answer = new RTCSessionDescription({
				  type	:'answer',
				  sdp	: joined.sdp
				});
				
				//Set it
				await _this.pc.setRemoteDescription(answer);
				document.getElementById('unmuteVideo').style.display = 'block';
				document.getElementById('muteVideo').style.display = 'none';
			}catch(error){
				console.log(error)
			}
		});
	});
});