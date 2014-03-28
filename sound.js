/* Copyright (c) 2014 Jer Noble
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

function Sound(src) {

	if (Sound.audioContext === undefined) {
		var AudioContext = window.AudioContext || window.webkitAudioContext || window.mozAudioContext;
		Sound.audioContext = new AudioContext();
	}

	this._networkState = this.NETWORK.EMPTY;
	this._preload = this.PRELOAD.AUTO;
	this._buffered = {};
	this._readyState = this.READY.NOTHING;
	this._seeking = false;
	this._paused = true;
	this._defaultPlaybackRate = 1;
	this._playbackRate = 1;
	this._played = {};
	this._seekable = {};
	this._ended = false;
	this._autoplay = true;
	this._loop = false;
	this._volume = 1;
	this._muted = false;
	this._defaultMuted = false;

	this.buffer = null;
	this.node = null;
	this.gainNode = null;

	this.ajax = null;
	this.eventListeners = { };
	this.startTime = 0;
	this.nextStartTime = 0;

	this.autoplaying = false;
	this.delayingTheLoadEvent = false;

	this.setSrc(src);
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

	PRELOAD: {
		NONE: 0,
		METADATA: 1,
		AUTO: 2,
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
		this.autoplaying = true;
		this.stopInternal();

		this.selectResource();
		
	},

	selectResource: function() {
		this._networkState = this.NETWORK.NO_SOURCE;
		this.delayingTheLoadEvent = true;

		setTimeout(this.selectResourceAsync.bind(this), 0);
	},

	selectResourceAsync: function() {
		if (!this._src) {
			this._networkState = this.NETWORK.EMPTY;
			return;
		}

		this._networkState = this.NETWORK.LOADING;
		this.dispatchEventAsync(new CustomEvent('loadstart'));

		setTimeout(this.fetchResource(), 0);
	},

	fetchResource: function() {
		if (this._preload === this.PRELOAD.NONE) {
			this._networkState = this.NETWORK.IDLE;
			this.dispatchEventAsync(new CustomEvent('suspend'));
			this.delayingTheLoadEvent = false;
			return;
		}

		this.ajax = new XMLHttpRequest();
		this.ajax.open("GET", this._src, true);
		this.ajax.responseType = "arraybuffer";
		this.ajax.onload = function() {
			if (!this.ajax.response)
				return;
			
			this._networkState = this.NETWORK.IDLE;
			this.dispatchEventAsync(new CustomEvent('suspend'));
			this.setReadyState(this.READY.FUTURE_DATA);

			try {
				Sound.audioContext.decodeAudioData(
					this.ajax.response,
					function(buffer) {
						this.buffer = buffer;
						if (this.autoplaying && this._paused && this._autoplay)
							this.play();
						this.dispatchEventAsync(new CustomEvent('canplaythrough'));
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
		this.ajax.onerror = function() {
			this.error = { code: MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED };
			this._networkState = this.NETWORK.NO_SOURCE;
			this.dispatchEventAsync(new CustomEvent('error'));
			this.delayingTheLoadEvent = false;
		}.bind(this);
		this.ajax.send();
	},

	play: function() {
		if (this._networkState === this.NETWORK.EMPTY)
			this.loadResource();

		if (!this.buffer) {
			this.autoplaying = true;
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
		this.gainNode.gain.value = this._muted ? 0 : this._volume;
		this.gainNode.connect(Sound.audioContext.destination);

		this.startTime = Sound.audioContext.currentTime;

		this.node = Sound.audioContext.createBufferSource();
		this.node.connect(this.gainNode);
		this.node.buffer = this.buffer;
		this.node.playbackRate.value = this._playbackRate;
		this.node.start(0, this.nextStartTime);
		this.node.onended = this.onended.bind(this);
	},


	pause: function() {
		if (this._networkState === this.NETWORK.EMPTY)
			this.loadResource();

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
		if (this._src)
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
		switch (this._preload) {
			case this.PRELOAD.NONE: return 'none';
			case this.PRELOAD.METADATA: return 'metadata';
			case this.PRELOAD.AUTO: return 'auto';
			default: return '';
		}
	},

	setPreload: function(preload) {
		switch (preload) {
			default:
			case 'none':
				this._preload = this.PRELOAD.NONE;
				break;
			case 'metadata':
				this._preload = this.PRELOAD.METADATA;
				if (this._networkState === this.NETWORK.EMPTY)
					this.load();
				break;
			case 'auto':
				this._preload = this.PRELOAD.auto;
				if (this._networkState === this.NETWORK.EMPTY)
					this.load();
				break;
		}
	},

	getCurrentTime: function() {
		if (!this.node)
			return this.nextStartTime;
		return this.nextStartTime + Sound.audioContext.currentTime - this.startTime;
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
		if (this._volume === volume)
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
		if (this._muted === muted)
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
		if (this._autoplay === autoplay)
			return;

		this._autoplay = autoplay;
		if (this._autoplay && this._networkState === this.NETWORK.EMPTY)
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

Object.defineProperty(Sound.prototype, 'preload', {
	get: Sound.prototype.getPreload,
	set: Sound.prototype.setPreload,
});

document.createElement = function(elementName) {
	if (elementName === "Audio" || elementName === "audio")
		return new Sound();
	return Document.prototype.createElement.call(this, elementName);
};

window.Audio = function(src) {
	return new Sound(src);
};