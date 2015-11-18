// Creates FileReader polyfill from FileReaderSync
// This is filereader-polyfill.js (warning: not tested).
var GLOBE = this;
(function() {
    if (GLOBE.FileReader || !GLOBE.FileReaderSync) {
        return;
    }
    function createExpandoEvent(obj, name) {
		return;
        var listenerCached = null;
		console.log('j0');
        Object.defineProperty(this, 'on' + name, {
            set: function(listener) {
                if (typeof (listener && listener.handleEvent || listener) != 'function')
                    listener = null;
				// this.removeEventListener(name, listenerCached);
                listenerCached = listener;
                // this.addEventListener(name, listener);
            },
            get: function() {
                return listenerCached;
            }
        });
		console.log('jEND');
    }
    function defineFileReaderMethod(methodName) {
        FileReader.prototype[methodName] = function() {
			console.log('called methodName:', methodName);
            var args = [].slice.call(arguments);
			console.log('args:', args);
            var fr = this;
            setTimeout(function() {
				console.log('triggered setTimeout for methodName:', methodName);
                try {
					console.log('will now apply');
					console.log('fr.thisFileReaderSync.readAsArrayBuffer:', fr.thisFileReaderSync[methodName]);
					fr.result = fr.thisFileReaderSync[methodName].apply(fr.thisFileReaderSync, args);
                    // fr.dispatchEvent(new CustomEvent('load'));
                    // fr.dispatchEvent(new CustomEvent('loadend'));
					if (fr.onload) {
						fr.onload({
							target: {
								result: fr.result
							}
						});
					}
					if (fr.onloadend) {
						fr.onloadend({
							target: {
								result: fr.result
							}
						});
					}
					console.log('ok dispatched custom events');
                } catch (e) {
					console.error('got e:', e);
                    fr.error = e;
                    // fr.dispatchEvent(new CustomEvent('error'));
					if (fr.onerror) {
						fr.onerror({
							error: fr.error
						});
					}
                }
            }); // Async
        };
    }
    GLOBE.FileReader = function() {
		console.log('creating expando 1');
        createExpandoEvent(this, 'load');
		console.log('creating expando 2');
        createExpandoEvent(this, 'error');
		console.log('expandos created');
		this.thisFileReaderSync = new FileReaderSync();
    };
    FileReader.prototype = Object.create(FileReaderSync.prototype);
    defineFileReaderMethod('readAsText');
    defineFileReaderMethod('readAsArrayBuffer');
    defineFileReaderMethod('readAsDataURL');
})();