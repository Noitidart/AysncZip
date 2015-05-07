// Imports
const {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;
Cu.import('resource:///modules/CustomizableUI.jsm');
Cu.import('resource://gre/modules/devtools/Console.jsm');
Cu.import('resource://gre/modules/FileUtils.jsm');
Cu.import('resource://gre/modules/osfile.jsm');
Cu.import('resource://gre/modules/Promise.jsm');
Cu.import('resource://gre/modules/Services.jsm');
Cu.import('resource://gre/modules/XPCOMUtils.jsm');
Cu.importGlobalProperties(['Blob']);

// Globals
const core = {
	addon: {
		name: 'AsyncZip',
		id: 'AsyncZip@jetpack',
		path: {
			name: 'asynczip',
			content: 'chrome://asynczip/content/',
			modules: 'chrome://asynczip/content/modules/',
			workers: 'chrome://asynczip//content/modules/workers/',
			locale: 'chrome://asynczip/locale/',
			resources: 'chrome://asynczip/content/resources/',
			images: 'chrome://asynczip/content/resources/images/'
		}
	},
	os: {
		name: OS.Constants.Sys.Name.toLowerCase()
	}
};
const cui_cssUri = Services.io.newURI(core.addon.path.resources + 'cui.css', null, null);

// Lazy Imports
const myServices = {};
XPCOMUtils.defineLazyGetter(myServices, 'hph', function () { return Cc['@mozilla.org/network/protocol;1?name=http'].getService(Ci.nsIHttpProtocolHandler); });
XPCOMUtils.defineLazyGetter(myServices, 'sb', function () { return Services.strings.createBundle(core.addon.path.locale + 'global.properties?' + Math.random()); /* Randomize URI to work around bug 719376 */ });

function extendCore() {
	// adds some properties i use to core
	switch (core.os.name) {
		case 'winnt':
		case 'winmo':
		case 'wince':
			core.os.version = parseFloat(Services.sysinfo.getProperty('version'));
			// http://en.wikipedia.org/wiki/List_of_Microsoft_Windows_versions
			if (core.os.version == 6.0) {
				core.os.version_name = 'vista';
			}
			if (core.os.version >= 6.1) {
				core.os.version_name = '7+';
			}
			if (core.os.version == 5.1 || core.os.version == 5.2) { // 5.2 is 64bit xp
				core.os.version_name = 'xp';
			}
			break;
			
		case 'darwin':
			var userAgent = myServices.hph.userAgent;
			//console.info('userAgent:', userAgent);
			var version_osx = userAgent.match(/Mac OS X 10\.([\d\.]+)/);
			//console.info('version_osx matched:', version_osx);
			
			if (!version_osx) {
				throw new Error('Could not identify Mac OS X version.');
			} else {
				var version_osx_str = version_osx[1];
				var ints_split = version_osx[1].split('.');
				if (ints_split.length == 1) {
					core.os.version = parseInt(ints_split[0]);
				} else if (ints_split.length >= 2) {
					core.os.version = ints_split[0] + '.' + ints_split[1];
					if (ints_split.length > 2) {
						core.os.version += ints_split.slice(2).join('');
					}
					core.os.version = parseFloat(core.os.version);
				}
				// this makes it so that 10.10.0 becomes 10.100
				// 10.10.1 => 10.101
				// so can compare numerically, as 10.100 is less then 10.101
				
				//core.os.version = 6.9; // note: debug: temporarily forcing mac to be 10.6 so we can test kqueue
			}
			break;
		default:
			// nothing special
	}
	
	core.os.toolkit = Services.appinfo.widgetToolkit.toLowerCase();
	
	core.firefox = {};
	core.firefox.version = Services.appinfo.version;
	
	console.log('done adding to core, it is now:', core);
}

// START - Addon Functionalities
function saveZippedToDisk(aDOMWin, aArrayBuffer, aOSPath_destDir, aDefaultName) {
	
	var deferredMain_saveZippedToDisk = new Deferred();
	// prompt asking for folder and filename to save to

	var cIn = {value:aDefaultName};
	var cInput = Services.prompt.prompt(aDOMWin, 'Name of Zip File', 'What name do you want to save the zip with? (do not include extension)', cIn, null, {});
	if (!cInput) {
		throw new Error('cancelled'); // so it goes to aCatch and doesn't prompt user
	}
	var cOSPath = OS.Path.join(aOSPath_destDir, cIn.value + '.zip');
	
	var promise_write = OS.File.writeAtomic(cOSPath, new Uint8Array(aArrayBuffer), {
		tmpPath: cOSPath + '.tmp'
	});
	promise_write.then(
		function(aVal) {
			console.log('Fullfilled - promise_write - ', aVal);
			// start - do stuff here - promise_write
			deferredMain_saveZippedToDisk.resolve(cOSPath);
			// end - do stuff here - promise_write
		},
		function(aReason) {
			var rejObj = {name:'promise_write', aReason:aReason};
			console.warn('Rejected - promise_write - ', rejObj);
			deferred_createProfile.reject(rejObj);
		}
	).catch(
		function(aCaught) {
			var rejObj = {name:'promise_write', aCaught:aCaught};
			console.error('Caught - promise_write - ', rejObj);
			deferred_createProfile.reject(rejObj);
		}
	);
	
	return deferredMain_saveZippedToDisk.promise;
}

function saveUnzippedToDisk(aDOMWin, aArrayBuffer, aOSPath_destDir, aDefaultName) {
	var deferredMain_saveUnzippedToDisk = new Deferred();
	
	// globals for callbacks
	var cOSPath;
	
	var do_asksubdir = function() {
		// prompt asking if should create a folder in selected directory or should it just save the contents to the folder
		var cIn = {value:aDefaultName};
		var cInput = Services.prompt.prompt(aDOMWin, 'Create Subfolder?', 'Would you like to createa subfolder in destination directory of "' + aOSPath_destDir + '" to unzip the contents into?', cIn, null, {});
		if (cInput && cIn.value != '') {
			// make dir first then unzip
			cOSPath = OS.Path.join(aOSPath_destDir, cIn.value);
			do_makedir();
		} else {
			cOSPath = aOSPath_destDir;
			// unzip into dest dir
			do_unzip();
		}
	}
	
	var do_makedir = function() {
		var promise_makeit = OS.File.makeDir(cOSPath, {ignoreExisting:true});
		promise_makeit.then(
			function(aVal) {
				console.log('Fullfilled - promise_makeit - ', aVal);
				// start - do stuff here - promise_makeit
				do_unzip();
				// end - do stuff here - promise_makeit
			},
			function(aReason) {
				var rejObj = {name:'promise_makeit', aReason:aReason};
				console.warn('Rejected - promise_makeit - ', rejObj);
				deferredMain_saveUnzippedToDisk.reject(rejObj);
			}
		).catch(
			function(aCaught) {
				var rejObj = {name:'promise_makeit', aCaught:aCaught};
				console.error('Caught - promise_makeit - ', rejObj);
				deferredMain_saveUnzippedToDisk.reject(rejObj);
			}
		);
	}
	
	var do_unzip = function() {
		// use a BlobReader to read the zip from a Blob object
		var blob = new Blob([new Uint8Array(aArrayBuffer)], {type: 'application/octet-binary'});
		console.log('myServices.zip:', myServices.zip);
		myServices.zip.createReader(
			new myServices.zip.BlobReader(blob),
			function(reader) {

				// get all entries from the zip
				reader.getEntries(
					function(entries) {
						if (entries.length) {
							// get first entry content as text
							entries[0].getData(
								new myServices.zip.TextWriter(),
								function(text) {
									// text contains the entry data as a String
									console.log(text);

									// close the zip reader
									reader.close(function() {
										console.info('onclose callback');
									});

								},
								function(current, total) {
									console.info('onprogress callback', current, total);
								}
							);
						} else {
							console.error('no entries!');
						}
					}
				);
			},
			function(error) {
				console.error('onerror callback, error:', error);
			}
		);
	};
	
	do_asksubdir();

	return deferredMain_saveUnzippedToDisk.promise;
}

function downloadZipData(aStr) {
	return xhr(aStr, {
		aTimeout: 10000,
		aResponseType: 'arraybuffer'
	});
}

// END - Addon Functionalities

/*start - windowlistener*/
var windowListener = {
	//DO NOT EDIT HERE
	onOpenWindow: function (aXULWindow) {
		// Wait for the window to finish loading
		var aDOMWindow = aXULWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowInternal || Ci.nsIDOMWindow);
		aDOMWindow.addEventListener('load', function () {
			aDOMWindow.removeEventListener('load', arguments.callee, false);
			windowListener.loadIntoWindow(aDOMWindow);
		}, false);
	},
	onCloseWindow: function (aXULWindow) {},
	onWindowTitleChange: function (aXULWindow, aNewTitle) {},
	register: function () {
		
		// Load into any existing windows
		let DOMWindows = Services.wm.getEnumerator(null);
		while (DOMWindows.hasMoreElements()) {
			let aDOMWindow = DOMWindows.getNext();
			if (aDOMWindow.document.readyState == 'complete') { //on startup `aDOMWindow.document.readyState` is `uninitialized`
				windowListener.loadIntoWindow(aDOMWindow);
			} else {
				aDOMWindow.addEventListener('load', function () {
					aDOMWindow.removeEventListener('load', arguments.callee, false);
					windowListener.loadIntoWindow(aDOMWindow);
				}, false);
			}
		}
		// Listen to new windows
		Services.wm.addListener(windowListener);
	},
	unregister: function () {
		// Unload from any existing windows
		let DOMWindows = Services.wm.getEnumerator(null);
		while (DOMWindows.hasMoreElements()) {
			let aDOMWindow = DOMWindows.getNext();
			windowListener.unloadFromWindow(aDOMWindow);
		}
		/*
		for (var u in unloaders) {
			unloaders[u]();
		}
		*/
		//Stop listening so future added windows dont get this attached
		Services.wm.removeListener(windowListener);
	},
	//END - DO NOT EDIT HERE
	loadIntoWindow: function (aDOMWindow) {
		if (!aDOMWindow) { return }
		
		if (aDOMWindow.gBrowser) {
			var domWinUtils = aDOMWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils);
			domWinUtils.loadSheet(cui_cssUri, domWinUtils.AUTHOR_SHEET);
		}
	},
	unloadFromWindow: function (aDOMWindow) {
		if (!aDOMWindow) { return }
		
		if (aDOMWindow.gBrowser) {
			var domWinUtils = aDOMWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils);
			domWinUtils.removeSheet(cui_cssUri, domWinUtils.AUTHOR_SHEET);
		}
	}
};
/*end - windowlistener*/

function install() {}
function uninstall() {}

function startup(aData, aReason) {
	core.addon.aData = aData;
	extendCore();
	var nsIFile_workers = aData.installPath;
	nsIFile_workers.append('modules');
	nsIFile_workers.append('workers');
	var osPath_workers = OS.Path.join(nsIFile_workers.path, '');
	var filePath_workers = OS.Path.toFileURI(osPath_workers);
	var jarPath_workers = 'jar:' + filePath_workers.replace(aData.id + '.xpi', aData.id + '.xpi!');
	
	console.log(osPath_workers, filePath_workers, jarPath_workers);
	myServices.zip = Cu.import(core.addon.path.modules + 'zip.js').zip;
	myServices.zip.workerScriptsPath = jarPath_workers + '/';
	console.log('myServices.zip.workerScriptsPath:', myServices.zip.workerScriptsPath);
	
	CustomizableUI.createWidget({
		id: 'cui_asynczip',
		defaultArea: CustomizableUI.AREA_NAVBAR,
		label: myServices.sb.GetStringFromName('cui_asynczip_lbl'),
		tooltiptext: myServices.sb.GetStringFromName('cui_asynczip_tip'),
		onCommand: function(aEvent) {
			
			// globals for callbacks
			var aDOMWin = aEvent.target.ownerDocument.defaultView;
			var cInput;
			var cPrompt;
			var cArrBuff;
			
			var do_dl = function() {
				
				cInput = {value:'http://github.com/wet-boew/wet-boew/archive/master.zip'};
				cPrompt = Services.prompt.prompt(aDOMWin, myServices.sb.GetStringFromName('fetch_title'), myServices.sb.GetStringFromName('fetch_explain'), cInput, null, {});
				if (!cPrompt || cInput.value == '') { return }
			
				var promise_fetchZip = downloadZipData(cInput.value);
				promise_fetchZip.then(
					function(aVal) {
						console.log('Fullfilled - promise_fetchZip - ', aVal);
						// start - do stuff here - promise_fetchZip
						do_asksave(aVal.response);
						// end - do stuff here - promise_fetchZip
					},
					function(aReason) {
						var rejObj = {name:'promise_fetchZip', aReason:aReason};
						console.error('Rejected - promise_fetchZip - ', rejObj);
						//deferred_createProfile.reject(rejObj);
						Services.prompt.alert(aDOMWin, myServices.sb.GetStringFromName('fetch_fail_title'), myServices.sb.formatStringFromName('fetch_fail_msg', [cInput.value], 1));
					}
				).catch(
					function(aCaught) {
						var rejObj = {name:'promise_fetchZip', aCaught:aCaught};
						console.error('Caught - promise_fetchZip - ', rejObj);
						//deferred_createProfile.reject(rejObj);
						// this only happens on developer error so no need for prompt to user
					}
				);
			};
			
			var do_asksave = function(aArrayBuffer) {
				var cSelectItems = ['Zipped', 'Decompressed']
				var cSelectSelected = {};
				var cSelectInput = Services.prompt.select(aDOMWin, myServices.sb.GetStringFromName('save_type_title'), myServices.sb.GetStringFromName('save_type_ask'), cSelectItems.length, cSelectItems, cSelectSelected);
				if (!cSelectInput) { return }

				var fp = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
				fp.init(aDOMWin, 'Save in Folder', Ci.nsIFilePicker.modeGetFolder);
				
				var rv = fp.show();
				if (rv != Ci.nsIFilePicker.returnOK) { return }
				
				var cDefaultName = cInput.value.substr(cInput.value.lastIndexOf('/')+1).replace(/\.zip/i, '');
				console.info('cDefaultName:', cDefaultName, cSelectSelected.value);
				
				var promise_saveIt = cSelectSelected.value == 0 ? saveZippedToDisk(aDOMWin, aArrayBuffer, fp.file.path, cDefaultName) : saveUnzippedToDisk(aDOMWin, aArrayBuffer, fp.file.path, cDefaultName);
				promise_saveIt.then(
					function(aVal) {
						console.log('Fullfilled - promise_saveIt - ', aVal);
						// start - do stuff here - promise_saveIt
						Services.prompt.alert(aDOMWin, myServices.sb.GetStringFromName('fetch_save_done_title'), myServices.sb.GetStringFromName('fetch_save_done_msg'));
						showDownloadedFile(new FileUtils.File(aVal));
						// end - do stuff here - promise_saveIt
					},
					function(aReason) {
						var rejObj = {name:'promise_saveIt', aReason:aReason};
						console.warn('Rejected - promise_saveIt - ', rejObj);
						//deferred_createProfile.reject(rejObj);
						Services.prompt.alert(aDOMWin, myServices.sb.GetStringFromName('save_fail_title'), myServices.sb.formatStringFromName('save_fail_msg', [cInput.value, fp.file.path], 2));
					}
				).catch(
					function(aCaught) {
						var rejObj = {name:'promise_saveIt', aCaught:aCaught};
						console.error('Caught - promise_saveIt - ', rejObj);
						//deferred_createProfile.reject(rejObj);
						// this only happens on developer error so no need for prompt to user
					}
				);
				
			}

			do_dl();
		}
	});
	
	//windowlistener more
	windowListener.register();
	//end windowlistener more
}

function shutdown(aData, aReason) {
	if (aReason == APP_SHUTDOWN) { return }
	
	CustomizableUI.destroyWidget('cui_asynczip');
	
	//windowlistener more
	windowListener.unregister();
	//end windowlistener more
	
	Cu.unload(core.addon.path.modules + 'modules/zipjs.jsm');
}

// start - common helper functions
function Deferred() {
	if (Promise && Promise.defer) {
		//need import of Promise.jsm for example: Cu.import('resource:/gree/modules/Promise.jsm');
		return Promise.defer();
	} else if (PromiseUtils && PromiseUtils.defer) {
		//need import of PromiseUtils.jsm for example: Cu.import('resource:/gree/modules/PromiseUtils.jsm');
		return PromiseUtils.defer();
	} else if (Promise) {
		try {
			/* A method to resolve the associated Promise with the value passed.
			 * If the promise is already settled it does nothing.
			 *
			 * @param {anything} value : This value is used to resolve the promise
			 * If the value is a Promise then the associated promise assumes the state
			 * of Promise passed as value.
			 */
			this.resolve = null;

			/* A method to reject the assocaited Promise with the value passed.
			 * If the promise is already settled it does nothing.
			 *
			 * @param {anything} reason: The reason for the rejection of the Promise.
			 * Generally its an Error object. If however a Promise is passed, then the Promise
			 * itself will be the reason for rejection no matter the state of the Promise.
			 */
			this.reject = null;

			/* A newly created Pomise object.
			 * Initially in pending state.
			 */
			this.promise = new Promise(function(resolve, reject) {
				this.resolve = resolve;
				this.reject = reject;
			}.bind(this));
			Object.freeze(this);
		} catch (ex) {
			console.error('Promise not available!', ex);
			throw new Error('Promise not available!');
		}
	} else {
		throw new Error('Promise not available!');
	}
}

function SIPWorker(workerScopeName, aPath, aCore=core) {
	// "Start and Initialize PromiseWorker"
	// returns promise
		// resolve value: jsBool true
	// aCore is what you want aCore to be populated with
	// aPath is something like `core.addon.path.content + 'modules/workers/blah-blah.js'`
	
	// :todo: add support and detection for regular ChromeWorker // maybe? cuz if i do then ill need to do ChromeWorker with callback
	
	var deferredMain_SIPWorker = new Deferred();

	if (!(workerScopeName in bootstrap)) {
		bootstrap[workerScopeName] = new PromiseWorker(aPath);
		
		if ('addon' in aCore && 'aData' in aCore.addon) {
			delete aCore.addon.aData; // we delete this because it has nsIFile and other crap it, but maybe in future if I need this I can try JSON.stringify'ing it
		}
		
		var promise_initWorker = bootstrap[workerScopeName].post('init', [aCore]);
		promise_initWorker.then(
			function(aVal) {
				console.log('Fullfilled - promise_initWorker - ', aVal);
				// start - do stuff here - promise_initWorker
				deferredMain_SIPWorker.resolve(true);
				// end - do stuff here - promise_initWorker
			},
			function(aReason) {
				var rejObj = {name:'promise_initWorker', aReason:aReason};
				console.warn('Rejected - promise_initWorker - ', rejObj);
				deferredMain_SIPWorker.reject(rejObj);
			}
		).catch(
			function(aCaught) {
				var rejObj = {name:'promise_initWorker', aCaught:aCaught};
				console.error('Caught - promise_initWorker - ', rejObj);
				deferredMain_SIPWorker.reject(rejObj);
			}
		);
		
	} else {
		deferredMain_SIPWorker.reject('Something is loaded into bootstrap[workerScopeName] already');
	}
	
	return deferredMain_SIPWorker.promise;
	
}

function xhr(aStr, aOptions={}) {
	// currently only setup to support GET and POST
	// does an async request
	// aStr is either a string of a FileURI such as `OS.Path.toFileURI(OS.Path.join(OS.Constants.Path.desktopDir, 'test.png'));` or a URL such as `http://github.com/wet-boew/wet-boew/archive/master.zip`
	// Returns a promise
		// resolves with xhr object
		// rejects with object holding property "xhr" which holds the xhr object
	
	/*** aOptions
	{
		aLoadFlags: flags, // https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/NsIRequest#Constants
		aTiemout: integer (ms)
		isBackgroundReq: boolean, // https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest#Non-standard_properties
		aResponseType: string, // https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest#Browser_Compatibility
		aPostData: string
	}
	*/
	
	var aOptions_DEFAULT = {
		aLoadFlags: Ci.nsIRequest.LOAD_ANONYMOUS | Ci.nsIRequest.LOAD_BYPASS_CACHE | Ci.nsIRequest.INHIBIT_PERSISTENT_CACHING,
		aPostData: null,
		aResponseType: 'text',
		isBackgroundReq: true, // If true, no load group is associated with the request, and security dialogs are prevented from being shown to the user
		aTimeout: 0 // 0 means never timeout, value is in milliseconds
	}
	
	for (var opt in aOptions_DEFAULT) {
		if (!(opt in aOptions)) {
			aOptions[opt] = aOptions_DEFAULT[opt];
		}
	}
	
	// Note: When using XMLHttpRequest to access a file:// URL the request.status is not properly set to 200 to indicate success. In such cases, request.readyState == 4, request.status == 0 and request.response will evaluate to true.
	
	var deferredMain_xhr = new Deferred();
	console.log('here222');
	let xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);

	let handler = ev => {
		evf(m => xhr.removeEventListener(m, handler, !1));

		switch (ev.type) {
			case 'load':
			
					if (xhr.readyState == 4) {
						if (xhr.status == 200) {
							deferredMain_xhr.resolve(xhr);
						} else {
							var rejObj = {
								name: 'deferredMain_xhr.promise',
								aReason: 'Load Not Success', // loaded but status is not success status
								xhr: xhr,
								message: xhr.statusText + ' [' + ev.type + ':' + xhr.status + ']'
							};
							deferredMain_xhr.reject(rejObj);
						}
					} else if (xhr.readyState == 0) {
						var uritest = Services.io.newURI(aStr, null, null);
						if (uritest.schemeIs('file')) {
							deferredMain_xhr.resolve(xhr);
						} else {
							var rejObj = {
								name: 'deferredMain_xhr.promise',
								aReason: 'Load Failed', // didnt even load
								xhr: xhr,
								message: xhr.statusText + ' [' + ev.type + ':' + xhr.status + ']'
							};
							deferredMain_xhr.reject(rejObj);
						}
					}
					
				break;
			case 'abort':
			case 'error':
			case 'timeout':
				
					var rejObj = {
						name: 'deferredMain_xhr.promise',
						aReason: ev.type[0].toUpperCase() + ev.type.substr(1),
						xhr: xhr,
						message: xhr.statusText + ' [' + ev.type + ':' + xhr.status + ']'
					};
					deferredMain_xhr.reject(rejObj);
				
				break;
			default:
				var rejObj = {
					name: 'deferredMain_xhr.promise',
					aReason: 'Unknown',
					xhr: xhr,
					message: xhr.statusText + ' [' + ev.type + ':' + xhr.status + ']'
				};
				deferredMain_xhr.reject(rejObj);
		}
	};

	let evf = f => ['load', 'error', 'abort'].forEach(f);
	evf(m => xhr.addEventListener(m, handler, false));

	if (aOptions.isBackgroundReq) {
		xhr.mozBackgroundRequest = true;
	}
	
	if (aOptions.aTimeout) {
		xhr.timeout
	}
	
	if (aOptions.aPostData) {
		xhr.open('POST', aStr, true);
		xhr.channel.loadFlags |= aOptions.aLoadFlags;
		xhr.responseType = aOptions.aResponseType;
		xhr.send(aOptions.aPostData);		
	} else {
		xhr.open('GET', aStr, true);
		xhr.channel.loadFlags |= aOptions.aLoadFlags;
		xhr.responseType = aOptions.aResponseType;
		xhr.send(null);
	}
	
	return deferredMain_xhr.promise;
}

function showDownloadedFile(aFile) {
	//http://mxr.mozilla.org/mozilla-release/source/browser/components/downloads/src/DownloadsCommon.jsm#533
    if (!(aFile instanceof Ci.nsIFile))
      throw new Error("aFile must be a nsIFile object");
	  
	if (!aFile.exists())
		throw new Error('file does not exist!');
		
	try {
		if (aFile.isDirectory()) {
			aFile.launch();
		} else {
			aFile.reveal();
		}
	} catch (ex) {
		throw new Error('Failed to show due to exception: "' + ex + '"');
	}
}
// end - common helper functions