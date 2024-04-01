/* Copyright (c) 2014-2016 Jer Noble
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

class Sound {
    static ERR = {
        NONE: 0,
        ABORTED: 1,
        NETWORK: 2,
        DECODE: 3,
        SRC_NOT_SUPPORTED: 4,
    };

    static NETWORK = {
        EMPTY: 0,
        IDLE: 1,
        LOADING: 2,
        NO_SOURCE: 3,
    };

    static READY = {
        NOTHING: 0,
        METADATA: 1,
        CURRENT_DATA: 2,
        FUTURE_DATA: 3,
        ENOUGH_DATA: 4,
    };

    static PRELOAD = {
        NONE: 0,
        METADATA: 1,
        AUTO: 2,
    };

    static TimeRanges = class TimeRanges {
        constructor() {
            Object.defineProperties(this, {
                length: {
                    get: this.#getLength,
                    enumerable: true,
                },
            });
        }

        #ranges = [];

        #getLength() {
            return this.#ranges.length;
        }

        start(index) {
            if (index >= this.length || index < 0)
                throw new RangeError();
            return this.#ranges[index].start;
        }

        end(index) {
            if (index >= this.length || index < 0)
                throw new RangeError();
            return this.#ranges[index].end;
        }

        add(start, end) {
            let found = this.#ranges.findLast(range => { return range.end <= start });
            if (found === undefined) {
                this.#ranges.push({ start: start, end: end });
                return;
            }
        }

        clear() {
            this.#ranges = [];
        }
    };

    #priv = {
        networkState: Sound.NETWORK.EMPTY,
        preload: Sound.PRELOAD.AUTO,
        buffered: new Sound.TimeRanges(),
        readyState: Sound.READY.NOTHING,
        seeking: false,
        paused: true,
        defaultPlaybackRate: 1,
        playbackRate: 1,
        played: {},
        seekable: new Sound.TimeRanges(),
        autoplay: true,
        loop: false,
        volume: 1,
        muted: false,
        defaultMuted: false,
        error: null,
        seekOperation: null,
        selectResourceTimer: null,
        fetchResourceTimer: null,
        timeUpdateTimer: null,
        buffer: null,
        node: null,
        gainNode: null,
        ajax: null,
        eventListeners: { },
        startTime: 0,
        nextStartTime: 0,
        autoplaying: false,
        delayingTheLoadEvent: false,
        sentLoadedData: false,
        src: '',
    };

    constructor(src) {
        if (Sound.audioContext === undefined) {
            var AudioContext = window.AudioContext || window.webkitAudioContext || window.mozAudioContext;
            try {
                Sound.audioContext = new AudioContext({latencyHint: "playback"});
            } catch(e) {
                Sound.audioContext = new AudioContext();
            }
        }

        try {
            navigator.audioSession.type = 'playback';
        } catch(e) { };

        Object.defineProperties(this, {
            duration: {
                get: this.#getDuration,
                enumerable: true,
            },
            currentTime: {
                get: this.#getCurrentTime,
                set: this.#setCurrentTime,
                enumerable: true,
            },
            src: {
                get: this.#getSrc,
                set: this.#setSrc,
                enumerable: true,
            },
            currentSrc: {
                get: this.#getCurrentSrc,
                enumerable: true,
            },
            ended: {
                get: this.#getEnded,
                enumerable: true,
            },
            networkState: {
                get: this.#getNetworkState,
                enumerable: true,
            },
            readyState: {
                get: this.#getReadyState,
                enumerable: true,
            },
            preload: {
                get: this.#getPreload,
                set: this.#setPreload,
                enumerable: true,
            },
            paused: {
                get: this.#getPaused,
                enumerable: true,
            },
            playbackRate: {
                get: this.#getPlaybackRate,
                set: this.#setPlaybackRate,
                enumerable: true,
            },
            defaultPlaybackRate: { 
                get: this.#getDefaultPlaybackRate,
                set: this.#setDefaultPlaybackRate,
                enumerable: true,
            },
            volume: { 
                get: this.#getVolume,
                set: this.#setVolume,
                enumerable: true,
            },
            muted: { 
                get: this.#getMuted,
                set: this.#setMuted,
                enumerable: true,
            },
            autoplay: { 
                get: this.#getAutoplay,
                set: this.#setAutoplay,
                enumerable: true,
            },
            loop: { 
                get: this.#getLoop,
                set: this.#setLoop,
                enumerable: true,
            },
            seekable: {
                get: this.#getSeekable,
                enumerable: true,
            },
            buffered: {
                get: this.#getBuffered,
                enumerable: true,
            }
        });

        this.#priv.sentLoadedData = false;
        this.#priv.src = src;
    }

    load() {
        if (this.networkState === Sound.NETWORK.LOADING || this.networkState === Sound.NETWORK.IDLE)
            this.#dispatchEventAsync(new CustomEvent('abort'));

        if (this.networkState !== Sound.NETWORK.EMPTY) {
            this.#dispatchEventAsync(new CustomEvent('emptied'));

            if (this.#priv.ajax)
                this.#priv.ajax.abort();

            if (this.#priv.selectResourceTimer) {
                clearTimeout(this.#priv.selectResourceTimer);
                this.#priv.selectResourceTimer = null;
            }

            if (this.#priv.selectResourceTimer) {
                clearTimeout(this.#priv.selectResourceTimer);
                this.#priv.selectResourceTimer = null;
            }

            if (this.#priv.readyState != Sound.READY.NOTHING)
                this.#setReadyState(Sound.READY.NOTHING);

            if (!this.#priv.paused)
                this.pause();

            if (this.#priv.seeking)
                this.#abortSeek();

            this.#priv.nextStartTime = 0;
            this.#priv.buffer = null;
            this.#priv.buffered.clear();
            this.#priv.seekable.clear();
        }

        this.playbackRate = this.defaultPlaybackRate;
        this.#priv.error = null;
        this.#priv.autoplaying = true;
        this.#stopInternal();
        this.#priv.sentLoadedData = false;

        this.#selectResource();
    }

    #selectResource() {
        this.#priv.networkState = Sound.NETWORK.NO_SOURCE;
        this.#priv.delayingTheLoadEvent = true;

        this.#priv.selectResourceTimer = setTimeout(this.#selectResourceAsync.bind(this), 0);
    }

    #selectResourceAsync() {
        this.#priv.selectResourceTimer = null;

        if (!this.#priv.src) {
            this.#priv.networkState = Sound.NETWORK.EMPTY;
            return;
        }

        this.#priv.networkState = Sound.NETWORK.LOADING;
        this.#dispatchEventAsync(new CustomEvent('loadstart'));

        this.#priv.selectResourceTimer = setTimeout(this.#fetchResource(), 0);
    }

    #fetchResource() {
        this.#priv.selectResourceTimer = null;

        if (this.#priv.preload === Sound.PRELOAD.NONE) {
            this.#priv.networkState = Sound.NETWORK.IDLE;
            this.#dispatchEventAsync(new CustomEvent('suspend'));
            this.#priv.delayingTheLoadEvent = false;
            return;
        }

        this.#priv.ajax = new XMLHttpRequest();
        this.#priv.ajax.open("GET", this.#priv.src, true);
        this.#priv.ajax.responseType = "arraybuffer";
        this.#priv.ajax.onprogress = this.#resourceFetchingProgressed.bind(this);
        this.#priv.ajax.onload = this.#resourceFetchingSucceeded.bind(this);
        this.#priv.ajax.onerror = this.#resourceFetchingFailed.bind(this);
        this.#priv.ajax.send();
    }

    #resourceFetchingProgressed() {
        this.#dispatchEventAsync(new CustomEvent('progress'));
    }

    #resourceFetchingSucceeded() {
        if (!this.#priv.ajax.response)
            return;

        this.#priv.networkState = Sound.NETWORK.IDLE;
        this.#dispatchEventAsync(new CustomEvent('suspend'));
        this.#setReadyState(Sound.READY.METADATA);

        try {
            Sound.audioContext.decodeAudioData(
                this.#priv.ajax.response,
                this.#resourceDecodingSucceeded.bind(this),
                this.#resourceDecodingFailed.bind(this)
            );
        } catch(exception) {
            console.log(exception);
        }
    }

    #resourceFetchingFailed() {
        this.error = { code: MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED };
        this.#priv.networkState = Sound.NETWORK.NO_SOURCE;
        this.#dispatchEventAsync(new CustomEvent('error'));
        this.#priv.delayingTheLoadEvent = false;
    }

    #resourceDecodingSucceeded(buffer) {
        this.#priv.buffer = buffer;

        this.#priv.buffered.add(0, buffer.duration);
        this.#priv.seekable.add(0, buffer.duration);

        this.#dispatchEventAsync(new CustomEvent('durationchange'));
        this.#setReadyState(Sound.READY.ENOUGH_DATA);

        if (this.#priv.autoplaying && this.#priv.paused && this.#priv.autoplay)
            this.play();
        this.#dispatchEventAsync(new CustomEvent('canplaythrough'));
    }

    #resourceDecodingFailed(error) {
        this.#priv.error = { code: HTMLMediaElement.MEDIA_ERR_DECODE };
        this.#dispatchEventAsync(new CustomEvent('error'));
        if (this.#priv.readyState === Sound.READY.NOTHING) {
            this.#priv.networkState = Sound.NETWORK.EMPTY;
            this.#dispatchEventAsync('emptied');
        } else
            this.#priv.networkState = Sound.NETWORK.IDLE;
    }

    play() {
        if (this.#priv.networkState === Sound.NETWORK.EMPTY)
            this.loadResource();

        if (!this.#priv.buffer) {
            this.#priv.autoplaying = true;
            return;
        }

        if (this.#priv.node)
            return;

        if (this.#endedPlayback()) {
            if (this.#priv.playbackRate > 0)
                this.#seekInternal(0);
            else
                this.#seekInternal(this.duration);
        }

        if (this.#priv.paused || this.#endedPlayback()) {
            this.#priv.paused = false;
            this.#dispatchEventAsync(new CustomEvent('play'));

            if (this.#priv.readyState < Sound.READY.FUTURE_DATA)
                this.#dispatchEventAsync(new CustomEvent('waiting'));
            else
                this.#dispatchEventAsync(new CustomEvent('playing'));
        }

        this.#priv.autoplay = false;

        this.#playInternal();
    }

    #playInternal() {
        this.#priv.gainNode = Sound.audioContext.createGain();
        this.#priv.gainNode.gain.value = this.#priv.muted ? 0 : this.#priv.volume;
        this.#priv.gainNode.connect(Sound.audioContext.destination);

        this.#priv.startTime = Sound.audioContext.currentTime;

        this.#priv.node = Sound.audioContext.createBufferSource();
        this.#priv.node.connect(this.#priv.gainNode);
        this.#priv.node.buffer = this.#priv.buffer;
        this.#priv.node.playbackRate.value = this.#priv.playbackRate;
        this.#priv.node.onended = this.#onended.bind(this);
        if (this.#priv.playbackRate < 0)
            this.#priv.node.start(0, 0, this.#priv.nextStartTime);
        else
            this.#priv.node.start(0, this.#priv.nextStartTime, Math.max(0, this.#priv.buffer.duration - this.#priv.nextStartTime));

        this.#priv.timeUpdateTimer = setInterval(this.#sendTimeUpdate.bind(this), 250);
    }

    #sendTimeUpdate() {
        this.#dispatchEventAsync(new CustomEvent('timeupdate'));
    }

    pause() {
        if (this.#priv.networkState === Sound.NETWORK.EMPTY)
            this.loadResource();

        this.#priv.autoplay = false;

        if (!this.#priv.paused) {
            this.#priv.paused = true;
            this.#dispatchEventAsync(new CustomEvent('timeupdate'));
            this.#dispatchEventAsync(new CustomEvent('pause'));
        }

        if (!this.#priv.buffer || !this.#priv.node)
            return;

        this.#priv.nextStartTime = Math.max(0, Math.min(this.#priv.playbackRate * (Sound.audioContext.currentTime - this.#priv.startTime), this.duration));
        this.#stopInternal();
    }

    #stopInternal() {
        if (this.#priv.node) {
            this.#priv.node.disconnect();
            this.#priv.node = null;
        }
        if (this.#priv.gainNode) {
            this.#priv.gainNode.disconnect();
            this.#priv.gainNode = null;
        }

        clearInterval(this.#priv.timeUpdateTimer);
    }

    #onended() {
        if (this.#priv.loop) {
            this.#priv.nextStartTime = this.#priv.playbackRate < 0 ? this.duration : 0;
            this.#stopInternal();
            this.#playInternal();
            return;
        }

        this.#dispatchEventAsync(new CustomEvent('timeupdate'));

        if (this.#endedPlayback() && !this.#priv.paused) {
            this.#priv.paused = true;
            this.#priv.nextStartTime = this.#priv.playbackRate < 0 ? 0 : this.duration;
            this.#stopInternal();
            this.#dispatchEventAsync(new CustomEvent('pause'));
        }
        this.#dispatchEventAsync(new CustomEvent('ended'));
    }

    #endedPlayback() {
        if (this.#priv.readyState < Sound.READY.METADATA)
            return false;

        if (this.currentTime >= this.duration && this.#priv.playbackRate >= 0 && !this.#priv.loop)
            return true;

        if (this.currentTime <= 0 && this.#priv.playbackRate <= 0 && !this.#priv.loop)
            return true;

        return false;
    }

    #getEnded() {
        return this.#endedPlayback() && this.#priv.playbackRate >= 0;
    }

    addEventListener(eventName, handler) {
        if (!this.#priv.eventListeners[eventName])
            this.#priv.eventListeners[eventName] = [];

        var listeners = this.#priv.eventListeners[eventName];
        if (listeners.indexOf(handler) !== -1)
            return;

        listeners.push(handler);
    }

    removeEventListener(eventName, handler) {
        if (!this.#priv.eventListeners[eventName])
            return;

        var listeners = this.#priv.eventListeners[eventName];
        var index = listeners.indexOf(handler);
        if (index === -1)
            return;

        listeners.splice(index, 1);
    }

    #dispatchEventAsync(event) {
        window.setTimeout(this.dispatchEvent.bind(this, event), 0);
    }

    dispatchEvent(event) {
        if (!this.#priv.eventListeners[event.type])
            return;

        var listeners = this.#priv.eventListeners[event.type];
        listeners.forEach(function(listener) {
            listener.call(this, event);
        });
    }

    #getSrc() {
        return this.#priv.src;
    }

    #setSrc(src) {
        this.#priv.src = src;
        if (this.#priv.src)
            this.load();
    }

    #getCurrentSrc() {
        return this.#priv.src;
    }

    #getNetworkState() {
        return this.#priv.networkState;
    }

    #getReadyState() {
        return this.#priv.readyState;
    }

    #setReadyState(value) {
        var oldState = this.#priv.readyState;
        var newState = this.#priv.readyState = value;

        if (this.#priv.networkState === Sound.NETWORK.EMPTY)
            return;

        if (oldState === Sound.READY.NOTHING && newState === Sound.READY.METADATA)
            this.#dispatchEventAsync('loadedmetadata');

        if (oldState === Sound.READY.METADATA && newState >= Sound.READY.CURRENT_DATA) {
            if (!this.#priv.sentLoadedData)
                this.#dispatchEventAsync('loadeddata');
        }

        if (oldState >= Sound.READY.FUTURE_DATA && newState <= Sound.READY.CURRENT_DATA) {
            if (this.#priv.autoplaying && this.#priv.paused && this.#priv.autoplay && !this.#endedPlayback() && !this.#priv.error) {
                this.#dispatchEventAsync('timeupdate');
                this.#dispatchEventAsync('waiting');
                this.#priv.nextStartTime = this.#priv.playbackRate * (Sound.audioContext.currentTime - this.#priv.startTime);
                this.#stopInternal();
            }
        }

        if (oldState <= Sound.READY.CURRENT_DATA && newState === Sound.READY.FUTURE_DATA) {
            this.#dispatchEventAsync('canplay');
            if (!this.#priv.paused)
                this.#dispatchEventAsync('playing');
        }

        if (oldState <= Sound.READY.CURRENT_DATA && newState === Sound.READY.FUTURE_DATA) {
            this.#dispatchEventAsync('canplay');
            if (!this.#priv.paused) {
                this.#dispatchEventAsync('playing');
                this.#playInternal();
            }

            if (this.#priv.autoplaying && this.#priv.paused && this.#priv.autoplay)
                this.play();
        }
    }

    #getPreload() {
        switch (this.#priv.preload) {
            case Sound.PRELOAD.NONE: return 'none';
            case Sound.PRELOAD.METADATA: return 'metadata';
            case Sound.PRELOAD.AUTO: return 'auto';
            default: return '';
        }
    }

    #setPreload(preload) {
        switch (preload) {
            default:
            case 'none':
                this.#priv.preload = Sound.PRELOAD.NONE;
                break;
            case 'metadata':
                this.#priv.preload = Sound.PRELOAD.METADATA;
                if (this.#priv.networkState === Sound.NETWORK.EMPTY)
                    this.load();
                break;
            case 'auto':
                this.#priv.preload = Sound.PRELOAD.auto;
                if (this.#priv.networkState === Sound.NETWORK.EMPTY)
                    this.load();
                break;
        }
    }

    #getCurrentTime() {
        if (!this.#priv.node)
            return this.#priv.nextStartTime;
        return this.#priv.nextStartTime + this.#priv.playbackRate * (Sound.audioContext.currentTime - this.#priv.startTime);
    }

    #setCurrentTime(time) {
        this.#seekInternal(time, {async: true})
    }

    #seekInternal(time, options) {
        if (this.#priv.readyState == Sound.READY.NOTHING)
            return;

        if (this.#priv.seeking)
            this.#abortSeek();

        this.#priv.seeking = true;

        if (this.#priv.node)
            this.#stopInternal();

        let performSeek = (time) => {
            let targetTime = parseFloat(time);
            if (targetTime > this.duration)
                targetTime = this.duration;
            if (targetTime < 0)
                targetTime = 0;

            this.#dispatchEventAsync(new CustomEvent('seeking'));
            this.#priv.nextStartTime = targetTime;
            this.#priv.seeking = false;
            this.#dispatchEventAsync(new CustomEvent('timeupdate'));
            this.#dispatchEventAsync(new CustomEvent('seeked'));

            if (!this.#priv.paused)
                this.#playInternal();
        }

        if (options?.async)
            this.#priv.seekOperation = window.setTimeout(() => { performSeek(time); });
        else
            performSeek(time);
    }

    #abortSeek() {
        if (!this.#priv.seeking || !this.#priv.seekOperation)
            return;

        this.#priv.seeking = false;
        clearTimeout(_seekOperation);
        _seekOperation = null;
    }

    #getDuration() {
        if (!this.#priv.buffer)
            return NaN;

        return this.#priv.buffer.duration;
    }

    #getPaused() {
        return this.#priv.paused;
    }

    #getPlaybackRate() {
        return this.#priv.playbackRate;
    }

    #setPlaybackRate(rate) {
        var oldPlaybackRate = this.#priv.playbackRate;
        this.#priv.playbackRate = parseFloat(rate);
        this.#dispatchEventAsync(new CustomEvent('ratechange'));

        if (this.#priv.node) {
            var currentTime = Sound.audioContext.currentTime
            this.#priv.nextStartTime += oldPlaybackRate * (currentTime - this.#priv.startTime);
            this.#priv.startTime = currentTime;
            this.#priv.node.playbackRate.value = this.#priv.playbackRate;

            if ((oldPlaybackRate <= 0) != (this.#priv.playbackRate <= 0)) {
                this.#stopInternal();
                this.#playInternal();
            }
        }
    }

    #getDefaultPlaybackRate() {
        return this.#priv.defaultPlaybackRate;
    }

    #setDefaultPlaybackRate(rate) {
        this.#priv.defaultPlaybackRate = parseFloat(rate);
        this.#dispatchEventAsync(new CustomEvent('ratechange'));
    }

    #getVolume() {
        return this.#priv.volume;
    }

    #setVolume(volume) {
        if (this.#priv.volume === volume)
            return;

        this.#priv.volume = parseFloat(volume);
        this.#dispatchEventAsync(new CustomEvent('volumechange'));

        if (this.#priv.gainNode)
            this.#priv.gainNode.gain.value = this.#priv.muted ? 0 : this.#priv.volume;
    }

    #getMuted() {
        return this.#priv.muted;
    }

    #setMuted(muted) {
        if (this.#priv.muted === muted)
            return;

        this.#priv.muted = muted;
        this.#dispatchEventAsync(new CustomEvent('volumechange'));

        if (this.#priv.gainNode)
            this.#priv.gainNode.gain.value = this.#priv.muted ? 0 : this.#priv.volume;
    }

    #getAutoplay() {
        return this.#priv.autoplay;
    }

    #setAutoplay(autoplay) {
        if (this.#priv.autoplay === autoplay)
            return;

        this.#priv.autoplay = autoplay;
        if (this.#priv.autoplay && this.#priv.networkState === Sound.NETWORK.EMPTY)
            this.load();
    }

    #getLoop() {
        return this.#priv.loop;
    }

    #setLoop(loop) {
        this.#priv.loop = loop;
    }

    #getBuffered() {
        return this.#priv.buffered;
    }

    #getSeekable() {
        return this.#priv.seekable;
    }
}

document.createElement = function(elementName) {
    if (elementName === "Audio" || elementName === "audio")
        return new Sound();
    return Document.prototype.createElement.call(this, elementName);
};

window.Audio = function(src) {
    return new Sound(src);
};
