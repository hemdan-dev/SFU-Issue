const EventEmitter	= require('events').EventEmitter;
const Logger		= require("./Logger");
//Get Semantic SDP objects
const SemanticSDP	= require("semantic-sdp");
const SDPInfo		= SemanticSDP.SDPInfo;
const MediaInfo		= SemanticSDP.MediaInfo;
const CandidateInfo	= SemanticSDP.CandidateInfo;
const DTLSInfo		= SemanticSDP.DTLSInfo;
const ICEInfo		= SemanticSDP.ICEInfo;
const StreamInfo	= SemanticSDP.StreamInfo;
const TrackInfo		= SemanticSDP.TrackInfo;
const Direction		= SemanticSDP.Direction;
const CodecInfo		= SemanticSDP.CodecInfo;


class Participant
{
	constructor(id,name,manager,room)
	{
		//Store props
		this.id = id;
		this.name = name;
		
		//Get manager
		this.manager = manager;
		
		//Listent for transport
		this.manager.on("transport",(transport)=>{
			//Store transport
			this.transport = transport;
			//Enable bandwidth probing
			/*this.transport.setBandwidthProbing(true);
			this.transport.setMaxProbingBitrate(256000);*/

			//Dump contents
			//this.transport.dump("/tmp/sfu-"+this.uri.join("-")+".pcap");
			//
			//Bitrate estimator
			/*this.transport.on("targetbitrate",(targetbitrate)=>{
				//If no other participants
				if (this.outgoingStreams.length)
					//Done
					return;

				//Split bitrate evenly
				let bitrate = targetbitrate/this.outgoingStreams.length;
				let assigned = 0;
				//For each stream
				for (const [streamId,stream] of this.outgoingStreams)
				{
					//Get video track
					const videoTrack = stream.getVideoTracks()[0];
					//Get transponder
					const transponder = videoTrack.getTransponder();
					//Set it
					assigned += transponder.setTargetBitrate(bitrate);
				}

			});*/
			
			//Listen for incoming tracks
			transport.on("incomingtrack",(track,incomingStream)=>{
				//Log
				this.logger.info("incomingtrack");
		
				//If stream has already been processed
				if (incomingStream.uri)
					//ignore
					return;
				
				//Add origin
				incomingStream.uri = this.uri.concat(["incomingStreams",incomingStream.getId()]);
				
				//Listen for stop event
				incomingStream.once("stopped",()=>{
					//If not ended
					this.incomingStreams.delete(incomingStream.id);
				});

				//Append
				this.incomingStreams.set(incomingStream.id,incomingStream);

				//Publish stream
				this.logger.info("onstream");
				this.emitter.emit("stream",incomingStream);
				
			});
		});
		
		//Listent for renegotiation events
		this.manager.on("renegotiationneeded", async ()=>{
			//Check not closed
			if (!this.manager)
				return;
			const localSdp = this.manager.createLocalDescription();
			const sdp = SDPInfo.process(localSdp);
			let streamsData = [];
			for (let stream of sdp.getStreams().values()) {
				streamsData.push({
					streamId: stream.getId(),
					participant: this.outgoingStreams.get(stream.getId()).participant,
				});
			}
			//Emit event
			this.logger.info("onrenegotiationneeded");
			this.emitter.emit("renegotiationneeded", {sdp:localSdp,streams:streamsData});
		});
			
		//Create event emitter
		this.emitter = new EventEmitter();
		
		//Streams
		this.incomingStreams = new Map();
		this.outgoingStreams = new Map();
		
		//Create uri
		this.uri = room.uri.concat(["participants",id]);
		
		//Get child logger
		this.logger = room.logger.child("participants["+id+"]");
	}
	
	getId() 
	{
		return this.id;
	}
	
	init(sdp) {
		//Log
		this.logger.info("init");
		
		//Process it
		this.manager.processRemoteDescription(sdp);
		
		//Return local sdp
		return this.manager.createLocalDescription();
	}
	
	update(sdp) {
		//Check not closed
		if (!this.manager)
			return;
		//Log
		this.logger.info("update");
		
		//Process it
		this.manager.processRemoteDescription(sdp);
	}

	updateIncomingStreamTrack(stream,tracks,newStream){
		let videoTrack;
		for(let track of tracks.values()){
			if(track.media == 'video') videoTrack = track;
		}
		const incomingStream = this.transport.getIncomingStream(stream.id);
		const createdTrack = incomingStream.createTrack(videoTrack);
		this.incomingStreams.set(incomingStream.id,incomingStream);
		return incomingStream;
	}

	updateOutgoingStreamTrack(stream,tracks,addedTrack,currentpart){
		try{
			let particpantOutgoingStream;
			for(let outgoingStream of this.outgoingStreams.values()){
				if(currentpart.getId() == outgoingStream.participant.id) particpantOutgoingStream = outgoingStream.stream;
			}
			let videoTrack = addedTrack.getVideoTracks()[0];
			/*for(let track of tracks.values()){
				if(track.media == 'video') videoTrack = track;
			}*/
			const outgoingStream = this.transport.getOutgoingStream(particpantOutgoingStream.id);
			const createdTrack = outgoingStream.createTrack(videoTrack.getMedia());
			const oldOut = this.outgoingStreams.get(outgoingStream.id);
			this.outgoingStreams.set(outgoingStream.id,{stream:outgoingStream,participant:oldOut.participant});
			//console.log(checkAgain.getStreamInfo())
			createdTrack.attachTo(videoTrack);
			//Listen remove events
			videoTrack.once("stopped",()=>{
				//Stop also ougoing
				createdTrack.stop();
			});
			return createdTrack;
		}catch(error){
			console.log("unexcpected error from add")
		}
	}

	removeVideoIncoming(){
		let incomingStreamData;
		for(let incomingStream of this.incomingStreams.values()){
			incomingStreamData = this.transport.getIncomingStream(incomingStream.id);
			const videoTracks = incomingStreamData.getVideoTracks();
			for(let video of videoTracks){
				video.stop();
			}
			this.incomingStreams.set(incomingStream.id,incomingStreamData);
		}
		return incomingStreamData;
	}

	removeVideoOutgoing(stream,participant){
		try{
			let particpantOutgoingStream;
			for(let outgoingStream of this.outgoingStreams.values()){
				if(participant.getId() == outgoingStream.participant.id) particpantOutgoingStream = outgoingStream.stream;
			}

			const outgoingStream = this.transport.getOutgoingStream(particpantOutgoingStream.id);
			const videoTracks = outgoingStream.getVideoTracks();
			for(let video of videoTracks){
				video.stop();
			}
			const oldOut = this.outgoingStreams.get(outgoingStream.id);
			this.outgoingStreams.set(outgoingStream.id,{stream:outgoingStream,participant:oldOut.participant});
			
			outgoingStream.attachTo(stream);
		}catch(error){
			console.log("unexcpected error from remove")
		}
	}

	addStream(stream,participant) {
		
		this.logger.info("addStream() "+stream.uri.join("/"));

		//console.log("audios",stream.getAudioTracks().length,"videos",stream.getVideoTracks().length)
		
		//Create sfu local stream
		const outgoingStream = this.transport.createOutgoingStream({
			audio: stream.getAudioTracks().length >= 1?true:false,
			video: stream.getVideoTracks().length >= 1?true:false,
		});

		//console.log(outgoingStream)
		
		//Add uri
		outgoingStream.uri = this.uri.concat(["outgoingStreams",outgoingStream.getId()]);
		
		//Append
		this.outgoingStreams.set(outgoingStream.getId(),{stream:outgoingStream,participant:participant});
			
		//Attach
		outgoingStream.attachTo(stream);
		
		//Listen when this stream is removed & stopped
		stream.on("stopped",()=>{
			//If we are already stopped
			if (!this.outgoingStreams)
				//Do nothing
				return;
			this.logger.info("removeStream() "+stream.uri.join("/"));
			//Remove stream from outgoing streams
			this.outgoingStreams.delete(outgoingStream.getId());
			//Remove stream
			outgoingStream.stop();
		});
	}
	
		
	getInfo() {
		//Create info 
		const info = {
			id	: this.id,
			name	: this.name,
			streams : [
				this.incomingStream ? this.incomingStream.getId() : undefined
			]
		};
		
		//Return it
		return info;
	}
	
	getIncomingStreams() {
		return this.incomingStreams.values();
	}
	
	/**
	 * Add event listener
	 * @param {String} event	- Event name 
	 * @param {function} listeener	- Event listener
	 * @returns {Transport} 
	 */
	on() 
	{
		//Delegate event listeners to event emitter
		this.emitter.on.apply(this.emitter, arguments);  
		//Return object so it can be chained
		return this;
	}
	
	/**
	 * Remove event listener
	 * @param {String} event	- Event name 
	 * @param {function} listener	- Event listener
	 * @returns {Transport} 
	 */
	off() 
	{
		//Delegate event listeners to event emitter
		this.emitter.removeListener.apply(this.emitter, arguments);
		//Return object so it can be chained
		return this;
	}
	
	stop() 
	{
		this.logger.info("stop");
		
		//remove all published streams
		for (let stream of this.incomingStreams.values())
			//Stop it
			stream.stop();
		

		//Remove all emitting streams
		if(this.outgoingStreams){
			//Remove all emitting streams
			for (let stream of this.outgoingStreams.values())
				//Stop it
				stream.stream.stop();
		}
			
		//IF we hve a transport
		if (this.transport)
			//Stop transport
			this.transport.stop();
		
		//Stop manager
		this.manager.stop();
		
		//Clean them
		this.room = null;
		this.incomingStreams = null;
		this.outgoingStreams = null;
		this.transport = null;
		this.manager = null;
		this.localSDP = null;
		this.remoteSDP = null;
	
		//Done
		this.logger.info("onstopped");
		this.emitter.emit("stopped");
	}
};

module.exports = Participant;
