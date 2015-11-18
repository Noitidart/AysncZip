// Creates FileReader polyfill from FileReaderSync
// This is filereader-polyfill.js (warning: not tested).
(function() {
	if (self.FileReader || !self.FileReaderSync) {
		return;
	}

	function defineFileReaderMethod(methodName) {
		FileReader.prototype[methodName] = function() {
			console.log('called methodName:', methodName);
			var args = [].slice.call(arguments);
			var fr = this;
			setTimeout(function() {
				try {
					fr.result = fr.thisFileReaderSync[methodName].apply(fr.thisFileReaderSync, args);
				} catch (e) {
					fr.error = e;
					if (fr.onerror) {
						fr.onerror({error:fr});
					}
				}
				if (fr.onload) {
					fr.onload({target:fr});
				}
				if (fr.onloadend) {
					fr.onloadend({target:fr});
				}
			}); // Async
		};
	}
  
	self.FileReader = function() {
		this.thisFileReaderSync = new FileReaderSync();
	};
  
	FileReader.prototype = Object.create(FileReaderSync.prototype);
	defineFileReaderMethod('readAsText');
	defineFileReaderMethod('readAsArrayBuffer');
	defineFileReaderMethod('readAsDataURL');
})();