/*jslint node: true */
/*globals describe,beforeEach,it*/
'use strict';
var assert = require("assert");
var SandboxedModule = require('sandboxed-module');

function createClient(httpget) {
    return SandboxedModule.require('../lib/hydra-node', {
        requires: {'request': {get: httpget}}
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
    });
});