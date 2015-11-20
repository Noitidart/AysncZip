// Imports
importScripts('resource://gre/modules/osfile.jsm');
importScripts("resource://gre/modules/workers/require.js");

// Setup PromiseWorker
var PromiseWorker = require('resource://gre/modules/workers/PromiseWorker.js');

// Instantiate AbstractWorker (see below).
var worker = new PromiseWorker.AbstractWorker()

worker.dispatch = function(method, args = []) {
	// Dispatch a call to method `method` with args `args`
	return self[method](...args);
};
worker.postMessage = function(...args) {
	// Post a message to the main thread
	self.postMessage(...args);
};
worker.close = function() {
	// Close the worker
	self.close();
};
worker.log = function(...args) {
	// Log (or discard) messages (optional)
	dump('Worker: ' + args.join(' ') + '\n');
};

// Connect it to message port.
self.addEventListener('message', msg => worker.handleMessage(msg));

// Globals
var core = { // have to set up the main keys that you want when aCore is merged from mainthread in init
	addon: {
		path: {
			content: 'chrome://asynczip/content/',
			modules: 'chrome://asynczip/content/modules/',
			workers: 'chrome://asynczip/content/modules/workers/',
		},
		cache_key: Math.random() // set to version on release
	},
	os: {
		name: OS.Constants.Sys.Name.toLowerCase()
	}
};

// Imports that use stuff defined in core
importScripts(core.addon.path.modules + 'filereadersync-polyfill.js?' + core.addon.cache_key, core.addon.path.modules + 'zip.js?' + core.addon.cache_key);
zip.workerScriptsPath = core.addon.path.workers;

var OSStuff = {}; // global vars populated by init, based on OS

////// end of imports and definitions

function init(objCore) { // function name init required for SIPWorker

	core = objCore;
	
	// // I import ostypes_*.jsm in init as they may use things like core.os.isWinXp etc
	// witch (core.os.toolkit.indexOf('gtk') == 0 ? 'gtk' : core.os.name) {
	// 	case 'winnt':
	// 	case 'winmo':
	// 	case 'wince':
	// 		importScripts(core.addon.path.content + 'modules/ostypes_win.jsm');
	// 		break
	// 	case 'gtk':
	// 		importScripts(core.addon.path.content + 'modules/ostypes_gtk.jsm');
	// 		break;
	// 	case 'darwin':
	// 		importScripts(core.addon.path.content + 'modules/ostypes_mac.jsm');
	// 		break;
	// 	default:
	// 		throw new MainWorkerError({
	// 			name: 'addon-error',
	// 			message: 'Operating system, "' + OS.Constants.Sys.Name + '" is not supported'
	// 		});
	// 
	
	// // OS Specific Init
	// switch (core.os.name) {
	// 	default:
	// 		// do nothing special
	// }

	console.log('AsyncZip MainWorker init success');
	
	return true; // required for SIPWorker
}

// Start - Addon Functionality
self.onclose = function() {
	console.log('MainWorker.js onClose entered');
}

// Define a custom error prototype.
function MainWorkerError(msgObj) {
  this.message = msgObj.message;
  this.name = msgObj.name;
}
MainWorkerError.prototype.toMsg = function() {
  return {
    exn: 'MainWorkerError',
    message: this.message,
	name: this.name
  };
};


function ensureDirAndUnzipIntoIt(aParams) {
	// aParams
		// unzipIntoDir - required
		// zipAsArrBuf - required
	
	makeDirAutofrom(aParams.unzipIntoDir);
	
	var arrOfEntries = []; // each is the entry.filename. so like "wet-boew-master/.bowerrc" for non directory, and "wet-boew-master/" for directory. in order from top most folder down to deepest.
	var arrOfEntryData = {}; // key is entry.filename, as in arrOfEntries, and value is object. if directory `isDir:true`. if file then `uint8arr:data`. 
	// use a BlobReader to read the zip from a Blob object
	var zipAsBlob = new Blob([new Uint8Array(aParams.zipAsArrBuf)], {type: 'application/octet-binary'});
	console.log('zip:', zip);
	console.log('zipAsBlob:', zipAsBlob);
	
	zip.createReader(new zip.Uint8ArrayReader(zipAsBlob),
		function(reader) {
			console.error('in createReader callback:', reader);
			// get all entries from the zip
			reader.getEntries(
				function(entries) {
					console.error('in entries callback:', entries);
					if (entries.length) {
						// get first entry content as text

						// ntries[0].getData(
						// 	new zip.TextWriter(),
						// 	function(text) {
						// 		// text contains the entry data as a String
						// 		console.log(text);
                        // 
						// 		// close the zip reader
						// 		reader.close(function() {
						// 			console.info('onclose callback');
						// 		});
                        // 
						// 	},
						// 	function(current, total) {
						// 		console.info('onprogress callback', current, total);
						// 	}
						// ;
					} else {
						console.error('no entries!');
					}
				}
			);
		},
		function(error) {
			console.error('in error cb');
			console.error('onerror callback, error:', error);
		}
	);
	
	return 'for now a string, as PromiseWorker doesnt handle returning a promises - i should mod it to handle it in soon future';
}
// End - Addon Functionality

// Start - Common Functions
// makeDirAutofrom - rev1 - https://gist.github.com/Noitidart/4cb5c99c428c5fad56ae
function makeDirAutofrom(aOSPath, aOptions={}) {
  // worker version
	// aOSPath is path to directory you want made
	// this functions checks if its parent exists, if it doesnt, it checks grandparent, and so on until it finds an existing. then it calls OS.File.makeDir(aOSPath, {from:FOUND_EXISTING})
	
	// aOptions
		// checkExistsFirst - if set to true, it checks if the dir at aOSPath exists, if it does then it quits. else it starts finding first existing parent then does create from there.
			// if true
				// if aOSPath DNE - then just one call happens. OS.File.Exists
				// if aOSPath EXISTS - then it does a minimum of 3 calls. first exist. then it checks parent exist, and assuming parent exists (just one loop here). then make dir.
			// if false
				// if aOSPath DNE - then minimum of 2 calls. loop check finds first parent exists, then makedir
				// if aOSPath EXISTS - still min of 2 calls. loop check finds first parent exists, then makedir
	var defaultOptions = {
		checkExistsFirst: false
	};
	
	// add to aOptions the defaults if a key for it was not found
	for (var p in defaultOptions) {
		if (!(p in defaultOptions)) {
			aOptions[p] = defaultOptions[p];
		}
	}
	
	if (aOptions.checkExistsFirst) {
		var itExists = OS.File.exists(aOSPath);
		if (itExists) {
			console.log('already existing');
			return true;
		}
	}
	
	var aOSPath_existingDir = aOSPath;
	var aExists;
	while (!aExists) {
		aOSPath_existingDir = OS.Path.dirname(aOSPath_existingDir);
		aExists = OS.File.exists(aOSPath_existingDir);
	}
	
	console.log('making from:', aOSPath_existingDir);
	var rez = OS.File.makeDir(aOSPath, {
		from: aOSPath_existingDir
	});
	
	console.log('rez:', rez);
}
// End - Common Functions