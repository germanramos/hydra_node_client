/*jslint node: true */
/*globals describe,beforeEach,it*/
'use strict';
var assert = require('chai').assert,
    expect = require('chai').expect,
    SandboxedModule = require('sandboxed-module'),
    empty = function() {};


var flushTimeout, flushInterval;

function createFlusher(f) {
    return function() {
        f();
    };
}

function createClient(httpget, timers) {
    var default_httpget = empty,
        default_timers = {
            setTimeout: function(f) {flushTimeout = createFlusher(f); return 1; },
            setInterval: function(f) {flushInterval = createFlusher(f); return 1; }
        },
        requires = {
            'request': {get: httpget || default_httpget},
            './timers': timers || default_timers
        };
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
            assert.equal(calledUrl, 'https://hydraserver/app/hydra');
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
            assert.equal(calledUrls.length, 1);
            flushTimeout();
            assert.equal(calledUrls.length, 2);
            flushTimeout();
            assert.equal(calledUrls.length, 3);
            servers.forEach(function (server, i) {
                assert.equal(calledUrls[i], server + '/app/hydra');
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
            assert.equal(calledUrls.length, 5);
            calledUrls.forEach(function (calledUrl, i) {
                assert.equal(calledUrl, servers[i % servers.length] + '/app/hydra');
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
            assert.deepEqual(hydra.config().servers, startingServers);
            flushTimeout();
            assert.deepEqual(hydra.config().servers, responseServers);
        });

        it('should not mantain a reference to array list parameter to prevent external changes', function () {
            var servers = ['https://hydraserver1', 'https://hydraserver2', 'https://hydraserver3'];
            hydra = createClient();
            hydra.config(servers);
            servers[0] = 'xx';
            assert.notDeepEqual(hydra.config().servers, servers);
        });

        it('should throw an exception if no hydra servers are informed', function () {
            var exceptionmessage = 'Empty hydra server list',
                servers = [];
            hydra = createClient();
            expect(function() {hydra.config(null, {}); }).to.throw(exceptionmessage);
            expect(function() {hydra.config(servers); }).to.throw(exceptionmessage);
        });
    });
});