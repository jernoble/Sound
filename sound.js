function Sound() {

	if (Sound.audioContext === undefined)
		Sound.audioContext = new webkitAudioContext();

	this._src = null;
	this._networkState = this.NETWORK.EMPTY;
	this._preload = true;
	this._buffered = {};
	this._readyState = this.READY.NOTHING;
	this._seeking = false;
	this._paused = true;
	this._defaultPlaybackRate = 1;
	this._playbackRate = 1;
	this._played = {};
	this._seekable = {};
	this._ended = false;
	this._autoplay = false;
	this._loop = false;
	this._volume = 1;
	this._muted = false;
	this._defaultMuted = false;

	this.buffer = null;
	this.node = null;
	this.gainNode = null;

	this.ajax = null;
	this.eventListeners = { }; 
	this.shouldBePlaying = 0;
	this.startTime = 0;
	this.nextStartTime = 0;
}

Sound.prototype = {
	/* Constants */
	ERR: {
		NONE: 0,
		ABORTED: 1,
		NETWORK: 2,
		DECODE: 3,
		SRC_NOT_SUPPORTED: 4,
	},

	NETWORK: {
		EMPTY: 0,
		IDLE: 1,
		LOADING: 2,
		NO_SOURCE: 3,
	},

	READY: {
		NOTHING: 0,
		METADATA: 1,
		CURRENT_DATA: 2,
		FUTURE_DATA: 3,
		ENOUGH_DATA: 4,
	},

	load: function() {
		if (this.ajax)
			this.ajax.abort();

		if (this.networkState === this.NETWORK.LOADING || this.networkState === this.NETWORK.IDLE) {
			this.dispatchEventAsync(new CustomEvent('emptied'));
			this.setReadyState(this.READY.NOTHING);
			if (!this._paused)
				this.pause();
			if (!this._seeking)
				this._seeking = false;
			this.setCurrentTime(0);
			this.buffer = null;
		}

		this.setPlaybackRate(this.defaultPlaybackRate);
		this._error = null;
		this._autoplay = true;
		this.stopInternal();

		if (!this._src) {
			this._networkState = this.NETWORK.EMPTY;
			return;
		}

		this._networkState = this.NETWORK.LOADING;
		this.dispatchEventAsync(new CustomEvent('loadstart'));

		this.ajax = new XMLHttpRequest();
		this.ajax.open("GET", this._src, true);
		this.ajax.responseType = "arraybuffer";
		this.ajax.onload = function() {
			if (!this.ajax.response)
				return;
			
			this.setReadyState(this.READY.FUTURE_DATA);

			try {
				Sound.audioContext.decodeAudioData(
					this.ajax.response, 
					function(buffer) {
						this.buffer = buffer;
						if (this.shouldBePlaying)
							this.play();
					}.bind(this), 
					function(error) { 
						console.log("Error in creating buffer for sound '" + this._src + "': " + error); 
					}.bind(this)
				);
			} catch(exception) {
				console.log(exception);
			}
		}.bind(this);
		this.ajax.onprogress = function() {
			this.dispatchEventAsync(new CustomEvent('progress'));
		}.bind(this);
		this.ajax.send();
	},

	play: function() {
		if (!this.buffer) {
			this.shouldBePlaying = true;			
			return;
		}

		if (this.node)
			return;

		if (this._ended && this._playbackRate > 0)
			this.setCurrentTime(0);

		if (this._paused || this._ended) {
			this._paused = false;
			this._ended = false;
			this.dispatchEventAsync(new CustomEvent('play'));

			if (this._readyState < this.READY.FUTURE_DATA)
				this.dispatchEventAsync(new CustomEvent('waiting'));
			else
				this.dispatchEventAsync(new CustomEvent('playing'));
		}

		this._autoplay = false;

		this.playInternal();
	},

	playInternal: function() {
		this.gainNode = Sound.audioContext.createGainNode();
		this.gainNode.gain.value = this._volume;
		this.gainNode.connect(Sound.audioContext.destination);

		this.node = Sound.audioContext.createBufferSource();
		this.node.connect(this.gainNode);
		this.node.buffer = this.buffer;
		this.node.playbackRate.value = this._playbackRate;
		this.node.start(0, this.nextStartTime);
		this.node.onended = this.onended.bind(this);
	},


	pause: function() {
		this._autoplay = false;

		if (!this._paused) {
			this._paused = true;
			this.dispatchEventAsync(new CustomEvent('timeupdate'));
			this.dispatchEventAsync(new CustomEvent('pause'));
		}

		if (!this.buffer || !this.node)
			return;

		this.nextStartTime = Sound.audioContext.currentTime - this.startTime;
		this.stopInternal();
	},

	stopInternal: function() {
		if (this.node) {
			this.node.disconnect();
			delete this.node;
		}
		if (this.gainNode) {
			this.gainNode.disconnect();
			delete this.gainNode;
		}
	},

	onended: function() {
		if (this._loop) {
			this.stopInternal();
			this.setCurrentTime(0);
			this.playInternal();
			return;
		}

		this._ended = true;
		this.nextStartTime = 0;
		this.stopInternal();
		this.dispatchEventAsync(new CustomEvent('ended'));
	},

	addEventListener: function(eventName, handler) {
		if (!this.eventListeners[eventName])
			this.eventListeners[eventName] = [];

		var listeners = this.eventListeners[eventName];
		if (listeners.indexOf(handler) !== -1)
			return;

		listeners.push(handler);
	},

	removeEventListener: function(eventName, handler) {
		if (!this.eventListeners[eventName])
			return;

		var listeners = this.eventListeners[eventName];
		var index = listeners.indexOf(handler);
		if (index === -1)
			return;

		listeners.splice(index, 1);
	},

	dispatchEventAsync: function(event) {
		window.setTimeout(this.dispatchEvent.bind(this, event), 0);
	},

	dispatchEvent: function(event) {
		if (!this.eventListeners[event.type])
			return;

		event.target = this;
		var listeners = this.eventListeners[event.type];
		listeners.forEach(function(listener) {
			listener.call(this, event);
		});
	},

	getSrc: function() {
		return this._src;
	},

	setSrc: function(src) {
		this._src = src;
		if (this._autoplay && this._src != null)
			this.load();
	},

	getCurrentSrc: function() {
		return this._src;
	},

	getNetworkState: function() {
		return this._networkState;
	},

	getReadyState: function() {
		return this._readyState;
	},

	setReadyState: function(value) {
		this._readyState = value;
	},

	getPreload: function() {
		if (!this._preload)
			return 'none';
		return 'auto';
	},

	setPreload: function(preload) {
		switch (preload) {
		case 'none':
			this._preload = false;
			break;
		default:
			this._preload = true;
			if (!this.buffer)
				load();
			break;
		}
	},

	getCurrentTime: function() {
		if (!this.node)
			return this.nextStartTime;
		return this.nextStartTime + Sound.audioContext.currentTIme - this.startTime;
	},

	setCurrentTime: function(time) { 
		this.nextStartTime = time;
		this.dispatchEventAsync(new CustomEvent('timeupdate'));
		if (!this.node)
			return;

		this.stopInternal();
		this.playInternal();
	},

	getDuration: function() {
		if (!this.buffer)
			return NaN;

		return this.buffer.duration;
	},

	getPaused: function() {
		return this._paused;
	},

	getPlaybackRate: function() {
		return this._playbackRate;
	},

	setPlaybackRate: function(rate) {
		this._playbackRate = rate;
		
		if (this.buffer) {
			this.stopInternal();
			this.playInternal();
		}
	},

	getVolume: function() {
		return this._volume;
	},

	setVolume: function(volume) {
		if (this._volume == volume)
			return;

		this._volume = volume;
		this.dispatchEventAsync(new CustomEvent('volumechange'));

		if (this.gainNode)
			this.gainNode.gain.value = this._muted ? 0 : this._volume;
	},

	getMuted: function() {
		return this._muted;
	},

	setMuted: function(muted) {
		if (this._muted == muted)
			return;

		this._muted = muted;
		this.dispatchEventAsync(new CustomEvent('volumechange'));

		if (this.gainNode)
			this.gainNode.gain.value = this._muted ? 0 : this._volume;
	},

	getAutoplay: function() {
		return this._autoplay;
	},

	setAutoplay: function(autoplay) {
		if (this._autoplay == autoplay)
			return;

		this._autoplay = autoplay;
		if (this._autoplay && this._src != null)
			this.load();
	},

	getLoop: function() {
		return this._loop;
	},

	setLoop: function(loop) {
		this._loop = loop;
	},
};

Object.defineProperty(Sound.prototype, 'src', {
	get: Sound.prototype.getSrc,
	set: Sound.prototype.setSrc,
});

Object.defineProperty(Sound.prototype, 'currentSrc', {
	get: Sound.prototype.getCurrentSrc,
});

Object.defineProperty(Sound.prototype, 'networkState', {
	get: Sound.prototype.getNetworkState,
});

Object.defineProperty(Sound.prototype, 'preload', {
	get: Sound.prototype.getPreload,
	set: Sound.prototype.setPreload,
});

Object.defineProperty(Sound.prototype, 'buffered', {
	get: Sound.prototype.getBuffered,
});

Object.defineProperty(Sound.prototype, 'readyState', {
	get: Sound.prototype.getReadyState,
});

Object.defineProperty(Sound.prototype, 'seeking', {
	get: Sound.prototype.getSeeking,
});

Object.defineProperty(Sound.prototype, 'currentTime', {
	get: Sound.prototype.getCurrentTime,
	set: Sound.prototype.setCurrentTime,
});

Object.defineProperty(Sound.prototype, 'duration', {
	get: Sound.prototype.getDuration,
});

Object.defineProperty(Sound.prototype, 'paused', {
	get: Sound.prototype.getPaused,
});

Object.defineProperty(Sound.prototype, 'defaultPlaybackRate', {
	get: Sound.prototype.getDefaultPlaybackRate,
	set: Sound.prototype.setDefaultPlaybackRate,
});

Object.defineProperty(Sound.prototype, 'playbackRate', {
	get: Sound.prototype.getPlaybackRate,
	set: Sound.prototype.setPlaybackRate,
});

Object.defineProperty(Sound.prototype, 'played', {
	get: Sound.prototype.getPlayed,
});

Object.defineProperty(Sound.prototype, 'seekable', {
	get: Sound.prototype.getSeekable,
});

Object.defineProperty(Sound.prototype, 'ended', {
	get: Sound.prototype.getEnded,
});

Object.defineProperty(Sound.prototype, 'autoplay', {
	get: Sound.prototype.getAutoplay,
	set: Sound.prototype.setAutoplay,
});

Object.defineProperty(Sound.prototype, 'loop', {
	get: Sound.prototype.getLoop,
	set: Sound.prototype.setLoop,
});

Object.defineProperty(Sound.prototype, 'controls', {
	get: Sound.prototype.getControls,
	set: Sound.prototype.setControls,
});

Object.defineProperty(Sound.prototype, 'volume', {
	get: Sound.prototype.getVolume,
	set: Sound.prototype.setVolume,
});

Object.defineProperty(Sound.prototype, 'muted', {
	get: Sound.prototype.getMuted,
	set: Sound.prototype.setMuted,
});

Object.defineProperty(Sound.prototype, 'defaultMuted', {
	get: Sound.prototype.getDefaultMuted,
	set: Sound.prototype.setDefaultMuted,
});

document.createElement = function(elementName) {
	if (elementName === "Audio" || elementName === "audio")
		return new Sound();
	return Document.prototype.createElement.call(this, elementName);
};