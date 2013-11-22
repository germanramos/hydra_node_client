/*jslint node: true */
'use strict';
var request = require('request'),
    timers = require('./timers');

/*mutually recursive methods*/
var loadHydraServers, scheduleHydraServersRefresh;

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
};
var timeouts = {};

var retryTimeout        = null;
var initialized         = false;

var _HTTP_SUCCESS       = 200,
    _HTTP_BAD_REQUEST   = 400;

function cycleHydraServers() {
    var list = appServers.hydra.list;
    list.push(list.shift());
}

function getConfig() {
    return {
        servers: appServers.hydra.list.slice(),
        timeouts: {
            hydra: timeouts.hydra,
            app: timeouts.app,
            retryOnFail: timeouts.retryOnFail
        }
    };
}

function setHydraServerList(serverlist) {
    if (!serverlist || !serverlist.length) {
        throw "Empty hydra server list";
    }
    appServers.hydra.list = serverlist.slice();
}

function setOptions(new_options) {
    ['hydra', 'app', 'retryOnFail'].forEach(function (prop) {
        timeouts[prop] = Math.max(defaultTimeouts[prop], new_options[prop] || 0);
    });
}

function initialize() {
    if (initialized) {
        return;
    }
    initialized = true;
    loadHydraServers();
}

function setConfig(serverlist, new_options) {
    setHydraServerList(serverlist);
    setOptions(new_options || {});
    initialize();
}

function parseNewHydraServers(data) {
    data = JSON.parse(data);
    if (data.length > 0) {
        appServers.hydra.list = data;
        appServers.hydra.lastUpdate = Date.now();
    }
}

scheduleHydraServersRefresh = function scheduleHydraServersRefresh(time) {
    retryTimeout = timers.setTimeout(function() {
        retryTimeout = null;
        loadHydraServers();
    }, time);
};

loadHydraServers = function loadHydraServers() {
    request.get(appServers.hydra.list[0] + '/app/hydra',
        function(err, res, data) {
            if (!err && res.statusCode === _HTTP_SUCCESS) {
                parseNewHydraServers(data);
                scheduleHydraServersRefresh(timeouts.hydra);
            } else {
                cycleHydraServers();
                scheduleHydraServersRefresh(timeouts.retryOnFail);
            }
        });
};

function validCacheCopy(appId) {
    return appServers[appId] &&
            appServers[appId].list.length > 0 &&
            (Date.now() - appServers[appId].lastUpdate < timeouts.app);
}

function getApp(appId) {
    // Get Apps from server if we specify to override the cache, it's not on the list or the list is empty or the cache is outdated
    var overrideCache = (arguments[2] ? arguments[1] : false),
        callback      = arguments[2] || arguments[1];

    if (!overrideCache && validCacheCopy(appId)) {
        callback(null, appServers[appId].list);
    } else {
        request.get(appServers.hydra.list[0] + '/app/' + appId,
            function(err, res, data) {
                if (!err && res.statusCode === _HTTP_SUCCESS) {
                    // Store the app in the local cache
                    data = JSON.parse(data);
                    appServers[appId] = {
                        list: data,
                        lastUpdate: Date.now()
                    };

                    retryTimeout = null;
                    callback(err, data);
                } else if (!err && res.statusCode === _HTTP_BAD_REQUEST) {
                    // If the app doesn't exist return the error
                    callback(new Error(data), null);
                } else if (err) {
                    // In case hydra server doesn't reply, push it to the back 
                    // of the list and try another
                    if (!retryTimeout) {
                        cycleHydraServers();
                    }

                    retryTimeout = timers.setTimeout(function() {
                        retryTimeout = null;
                        get(appId, overrideCache, callback);
                    }, timeouts.retryOnFail);
                }
            });
    } 
}

function get(appId, override, f_cbk) {
    if (!initialized) {
        throw new Error('Hydra client not initialized. Use hydra.config([<server list>], {<options>});');
    }
    getApp(appId, override, f_cbk);
}

function config(p_servers, p_options) {
    return (arguments.length === 0) ?
            getConfig() :
            setConfig(p_servers, p_options);
}


module.exports =  (function () {
    return {
        get: get,
        config: config
    };
}());