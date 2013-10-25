/*jslint node: true */
'use strict';
var request = require('request'),
	timers = require('./timers');


var appServers = {
	hydra : {
		list: [],
		lastUpdate : 0
	}
};

var defaultTimeouts = {
	hydra: 60000,  //timeout de cache de hydra servers
	app: 20000,  //timeout de cache de app servers
	retryOnFail: 500
}
var timeouts = {};

var retryTimeout		= null;
var initialized			= false;

var	_HTTP_SUCCESS		= 200,
	_HTTP_BAD_REQUEST	= 400;

//////////////////////////
//     HYDRA  ENTRY     //
//////////////////////////
function _Get(appId, override, f_cbk){
	if(!initialized) {
		throw Error('Hydra client not initialized. Use hydra.config([<server list>], {<options>});');
	}

	_GetApp(appId, override, f_cbk);
}

function _Config(p_servers, p_options) {
	if(arguments.length == 0) {
		return getConfig();
	} else {
		return setConfig(p_servers, p_options);
	}
}

function getConfig() {
	return {
		servers: appServers.hydra.list.slice(),
		timeouts: {
			hydra: timeouts.hydra,
			app: timeouts.app,
			retryOnFail: timeouts.retryOnFail
		}
	}
}

function setHydraServerList(serverlist){
	if (!!!serverlist || !!!serverlist.length) {
		throw "Empty hydra server list";
	}
	appServers.hydra.list = (serverlist).slice();
}
function setOptions(new_options){
	['hydra','app','retryOnFail'].forEach(function (prop){
		timeouts[prop] = Math.max(defaultTimeouts[prop], new_options[prop] || 0);
	});
}

function setConfig(serverlist, new_options) {
	setHydraServerList(serverlist);
	setOptions(new_options|| {});


	initialize();
}

//////////////////////////
//     HYDRA UTILS      //
//////////////////////////
function initialize(){
	if(initialized) return;

	initialized = true;
	_GetHydraServers();
	timers.setInterval(_GetHydraServers, timeouts.hydra);
}


function _GetHydraServers() {
	request.get(appServers.hydra.list[0] + '/app/hydra',
	function(err, res, data){
		if(!err && res.statusCode === _HTTP_SUCCESS) {
			data = JSON.parse(data);
			if (data.length > 0) {
				appServers.hydra.list = data;
				appServers.hydra.lastUpdate = Date.now();
			}

			retryTimeout = null;
		} else {
			// In case hydra server doesn't reply, push it to the back 
			// of the list and try another
			if(!retryTimeout) {
				_CycleHydraServer();
			}

			retryTimeout = timers.setTimeout(function() {
				retryTimeout = null;
				_GetHydraServers();
			}, timeouts.retryOnFail);
		}
	});
}

function _GetApp(appId, overrideCache, f_callback){
	// Get Apps from server if we specify to override the cache, it's not on the list or the list is empty or the cache is outdated
	var getFromServer = overrideCache ||
						!(appId in appServers) ||
						appServers[appId].list.length === 0 ||
						(Date.now() - appServers[appId].lastUpdate > timeouts.app);

	if(getFromServer) {
		request.get(appServers.hydra.list[0] + '/app/'+ appId,
		function(err, res, data){
			if(!err && res.statusCode === _HTTP_SUCCESS) {
				// Store the app in the local cache
				data = JSON.parse(data);
				appServers[appId] = {
					list: data,
					lastUpdate: Date.now()
				};

				retryTimeout = null;
				f_callback(err, data);
			} else if(!err && res.statusCode === _HTTP_BAD_REQUEST){
				// If the app doesn't exist return the error
				f_callback(new Error(data), null);
			} else if(err) {
				// In case hydra server doesn't reply, push it to the back 
				// of the list and try another
				if(!retryTimeout) {
					_CycleHydraServer();
				}

				retryTimeout = timers.setTimeout(function() {
					retryTimeout = null;
					_Get(appId, overrideCache, f_callback);
				}, timeouts.retryOnFail);
			}
		});
	} else {
		f_callback(null, appServers[appId].list);
	}
}

function _CycleHydraServer() {
	var list = appServers.hydra.list;
	list.push(list.shift());
}

//////////////////////////////
//     EXTERNAL METHODS     //
//////////////////////////////
module.exports =  function () {
	return {
		get: _Get,
		config: _Config
	};
}();