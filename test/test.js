/*jslint node: true */
/*globals describe,beforeEach,it*/
'use strict';
var assert = require('chai').assert,
    expect = require('chai').expect,
    SandboxedModule = require('sandboxed-module'),
    empty = function() {};


var flushTimeout, flushInterval, lastTimeout, lastInterval, now;

function createFlusher(f) {
    return function() {
        f();
    };
}

function createClient(httpget, timers) {
    var default_httpget = empty,
        default_timers = {
            setTimeout: function(f, timeout) {
                flushTimeout = createFlusher(f);
                lastTimeout = timeout;
                return 1;
            },
            setInterval: function(f, interval) {
                flushInterval = createFlusher(f);
                lastInterval = interval;
                return 1;
            },
            now: function (){
                return now;
            }
        },
        requires = {
            'request': {get: httpget || default_httpget},
            './timers': timers || default_timers
        };
    now = 0;
    lastTimeout = null;
    lastInterval = null;
    return SandboxedModule.require('../lib/hydra-node', {
        requires:  requires
    });
}

describe('hydra-node', function () {
    var hydra;
    describe('config', function() {
        it('should try to get an updated hydralist', function () {
            var calledUrl,
                httpget = function (url) {calledUrl = url; };
            hydra = createClient(httpget);

            hydra.config(['https://hydraserver']);
            expect(calledUrl).to.equal('https://hydraserver/app/hydra');
        });

        it('should wait options.retryOnFail before retrying on fail', function () {
            var servers = ['https://hydraserver1', 'https://hydraserver2'],
                httpget = function (url, cb) {
                    cb(true, {}, '{}');
                };
            hydra = createClient(httpget);
            hydra.config(servers.slice());
            expect(lastTimeout).to.equal(500);
        });

        it('should retry on the whole list', function () {
            var servers = ['https://hydraserver1', 'https://hydraserver2', 'https://hydraserver3'],
                calledUrls = [],
                httpget = function (url, cb) {
                    calledUrls.push(url);
                    cb(url !== 'https://hydraserver3/app/hydra', {statusCode: 200}, '{}');
                };
            hydra = createClient(httpget);
            hydra.config(servers.slice());
            expect(calledUrls.length).to.equal(1);
            flushTimeout();
            expect(calledUrls.length).to.equal(2);
            flushTimeout();
            expect(calledUrls.length).to.equal(3);
            servers.forEach(function (server, i) {
                expect(calledUrls[i]).to.equal(server + '/app/hydra');
            });
        });

        it('should cycle the server list when retrying', function () {
            var i,
                servers = ['https://hydraserver1', 'https://hydraserver2', 'https://hydraserver3'],
                calledUrls = [],
                getcalls = 0,
                httpget = function (url, cb) {
                    calledUrls.push(url);
                    getcalls += 1;
                    cb(getcalls !== 5, {statusCode: 200}, '{}');
                };
            hydra = createClient(httpget);
            hydra.config(servers.slice());
            for (i = 0; i < 4; i++) {
                flushTimeout();
            }
            expect(calledUrls.length).to.equal(5);
            calledUrls.forEach(function (calledUrl, i) {
                expect(calledUrl).to.equal(servers[i % servers.length] + '/app/hydra');
            });
        });

        it('should return the config', function () {
            var startingServers = ['https://hydraserver1', 'https://hydraserver2', 'https://hydraserver3'],
                responseServers = ['https://hydraserver2', 'https://hydraserver3', 'https://hydraserver4'],
                calledUrls = [],
                getcalls = 0,
                httpget = function (url, cb) {
                    calledUrls.push(url);
                    getcalls += 1;
                    cb(getcalls !== 2, {statusCode: 200}, JSON.stringify(responseServers));
                };
            hydra = createClient(httpget);
            flushTimeout();
            hydra.config(startingServers.slice());
            startingServers.push(startingServers.shift());
            expect(hydra.config().servers).to.deep.equal(startingServers);
            flushTimeout();
            expect(hydra.config().servers).to.deep.equal(responseServers);
        });

        it('should not mantain a reference to array list parameter to prevent external changes', function () {
            var servers = ['https://hydraserver1', 'https://hydraserver2', 'https://hydraserver3'];
            hydra = createClient();
            hydra.config(servers);
            servers[0] = 'xx';
            expect(hydra.config().servers).to.not.deep.equal(servers);
        });

        it('should throw an exception if no hydra servers are informed', function () {
            var exceptionmessage = 'Empty hydra server list',
                servers = [];
            hydra = createClient();
            expect(function() {hydra.config(null, {}); }).to.throw(exceptionmessage);
            expect(function() {hydra.config(servers); }).to.throw(exceptionmessage);
        });

        it('should should refresh hydra after refresh time', function () {
            var servers  = [['https://hydraserver1'],
                            ['https://hydraserver1', 'https://hydraserver2']],
                getcalls = -1,
                httpget = function (url, cb) {
                    getcalls++;
                    cb(null, {statusCode: 200}, JSON.stringify(servers[getcalls]));
                };
            hydra = createClient(httpget);
            hydra.config(servers[0]);
            expect(lastTimeout).to.equal(60000);
        });

        it('should should fallback to retry times if refresh fails', function () {
            var servers  = [['https://hydraserver1'],
                            ['https://hydraserver1', 'https://hydraserver2'],
                            ['https://hydraserver1', 'https://hydraserver2', 'https://hydraserver3']],
                getcalls = -1,
                httpget = function (url, cb) {
                    getcalls += 1;
                    cb(getcalls === 1, {statusCode: 200}, JSON.stringify(servers[getcalls]));
                };
            hydra = createClient(httpget);
            hydra.config(servers[0]);
            flushTimeout();
            expect(lastTimeout).to.equal(500);
            flushTimeout();
            expect(lastTimeout).to.equal(60000);
        });


        it('should set default timeouts options for timeouts (hydra refresh: 60000, app refresh: 200000, retry: 500)', function () {
            var timeouts;
            hydra = createClient();
            hydra.config(['server1']);
            timeouts = hydra.config().timeouts;
            expect(timeouts.hydra).to.equal(60000);
            expect(timeouts.app).to.equal(20000);
            expect(timeouts.retryOnFail).to.equal(500);
        });

        it('should use default timeouts options as minimum values for timeouts', function () {
            var timeouts;
            hydra = createClient();
            hydra.config(['server1'], {
                hydraTimeOut: 1,
                app: 1,
                retryOnFail: 1
            });
            timeouts = hydra.config().timeouts;
            expect(timeouts.hydra).to.equal(60000);
            expect(timeouts.app).to.equal(20000);
            expect(timeouts.retryOnFail).to.equal(500);
            hydra.config(['server1'], {
                hydra: 100000,
                app: 200000,
                retryOnFail: 300000
            });
            timeouts = hydra.config().timeouts;
            expect(timeouts.hydra).to.equal(100000);
            expect(timeouts.app).to.equal(200000);
            expect(timeouts.retryOnFail).to.equal(300000);
        });

    });

    describe('get(appID, nocache, callback)', function() {
        var cb, calledUrls, servers, ok = {statusCode: 200};
        beforeEach(function (){
            var httpget = function (url, _cb) {
                calledUrls.push(url);
                cb = _cb;
            };
            calledUrls = [];
            hydra = createClient(httpget);
            servers = ['https://hydraserver1', 'https://hydraserver2', 'https://hydraserver3'];
            hydra.config(servers, {
                hydraTimeOut: 1,
                app: 1,
                retryOnFail: 1
            });
            cb(null, {statusCode: 200}, JSON.stringify(servers));
            now = 0;
        })
        it('should throw an error if not initialized', function (){
            hydra = createClient();
            function getCall(){
                hydra.get("somapp",empty);
            }
            expect(getCall).to.throw('Hydra client not initialized. Use hydra.config([<server list>], {<options>});');
        });

        it('should get the app from the first server in the list', function (){
            var response, list=[1,2,3];
            hydra.get("somapp", false, function (err, list) {
                response = list;
            });
            cb(null, ok, JSON.stringify(list));
            expect(response).to.deep.equal(list);
            expect(calledUrls[1]).to.equal('https://hydraserver1/app/somapp')
        });

        it('should have nocache parameter as optional', function (){
            var response, list=[1,2,3];
            hydra.get("somapp", function (err, list) {
                response = list;
            });
            cb(null, ok, JSON.stringify(list));
            expect(response).to.deep.equal(list);
            expect(calledUrls[1]).to.equal('https://hydraserver1/app/somapp');
        });

        it('should hit the cache after the first request', function (){
            var response, list=[1,2,3];
            hydra.get("somapp", function (err, list) {
                response = list;
            });
            cb(null, ok, JSON.stringify(list));
            hydra.get("somapp", function (err, list) {
                response = list;
            });
            hydra.get("somapp", function (err, list) {
                response = list;
            });
            expect(response).to.deep.equal(list);
            expect(calledUrls[1]).to.equal('https://hydraserver1/app/somapp');
            expect(calledUrls.length).to.equal(2);
        })

        it('should ask server if nocache is true', function (){
            var response, list=[1,2,3];
            hydra.get("somapp", function (err, list) {
                response = list;
            });
            cb(null, ok, JSON.stringify(list));
            hydra.get("somapp", function (err, list) {
                response = list;
            });
            hydra.get("somapp", function (err, list) {
                response = list;
            });
            hydra.get("somapp", true, function (err, list) {
                response = list;
            });
            expect(response).to.deep.equal(list);
            expect(calledUrls[2]).to.equal('https://hydraserver1/app/somapp');
            expect(calledUrls.length).to.equal(3);
        });

        it('should ignore cache after timeout', function (){
            var response,
                list = [1,2,3],
                list2 = [4,5,6];
            hydra.get("somapp", function (err, list) {
                response = list;
            });
            cb(null, ok, JSON.stringify(list));
            hydra.get("somapp", function (err, list) {
                response = list;
            });
            hydra.get("somapp", function (err, list) {
                response = list;
            });
            expect(calledUrls.length).to.equal(2);
            now = hydra.config().timeouts.app * 2;
            hydra.get("somapp", function (err, list) {
                response = list;
            });
            expect(calledUrls.length).to.equal(3);
            cb(null, ok, JSON.stringify(list2));
            expect(response).to.deep.equal(list2);
        })
    });
});