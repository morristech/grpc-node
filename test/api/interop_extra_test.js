/*
 *
 * Copyright 2019 gRPC authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const interopServer = require('../interop/interop_server.js');
const anyGrpc = require('../any_grpc');
const grpc = anyGrpc.client;
var protoLoader = require('../../packages/proto-loader');

const protoPackage = protoLoader.loadSync(
  'src/proto/grpc/testing/test.proto',
  {keepCase: true,
   defaults: true,
   enums: String,
   includeDirs: [__dirname + '/../../packages/grpc-native-core/deps/grpc']});
const testProto = grpc.loadPackageDefinition(protoPackage).grpc.testing;

function multiDone(done, count) {
  return function() {
    count -= 1;
    if (count <= 0) {
      done();
    }
  };
}

function echoMetadataGenerator(options, callback) {
  const metadata = new grpc.Metadata();
  metadata.set('x-grpc-test-echo-initial', 'test_initial_metadata_value');
  callback(null, metadata);
}

const credentials = grpc.credentials.createFromMetadataGenerator(echoMetadataGenerator);

describe(`${anyGrpc.clientName} client -> ${anyGrpc.serverName} server`, function() {
  describe('Interop-adjacent tests', function() {
    let server;
    let client;
    before(function(done) {
      interopServer.getServer(0, true, (err, serverObj) => {
        if (err) {
          done(err);
        } else {
          server = serverObj.server;
          server.start();
          const ca_path = path.join(__dirname, '../data/ca.pem');
          const ca_data = fs.readFileSync(ca_path);
          const creds = grpc.credentials.createSsl(ca_data);
          const options = {
            'grpc.ssl_target_name_override': 'foo.test.google.fr',
            'grpc.default_authority': 'foo.test.google.fr'
          };
          client = new testProto.TestService(`localhost:${serverObj.port}`, creds, options);
          done();
        }
      });
    });
    after(function() {
      server.forceShutdown();
    });
    it('Should be able to start many concurrent calls', function(done) {
      const callCount = 100;
      done = multiDone(done, callCount);
      for (let i = 0; i < callCount; i++) {
        client.unaryCall({}, (error, result) => {
          assert.ifError(error);
          done();
        });
      }
    });
    it('Should echo metadata from call credentials', function(done) {
      done = multiDone(done, 2);
      const call = client.unaryCall({}, {credentials}, (error, result) => {
        assert.ifError(error);
        done();
      });
      call.on('metadata', (metadata) => {
        assert.deepEqual(metadata.get('x-grpc-test-echo-initial'),
                        ['test_initial_metadata_value']);
        done();
      });
    });
    it('Should be able to send the same metadata on two calls with call creds', function(done) {
      done = multiDone(done, 5);
      const metadata = new grpc.Metadata();
      metadata.set('x-grpc-test-echo-trailing-bin', Buffer.from('ababab', 'hex'));
      const call1 = client.unaryCall({}, metadata, {credentials}, (error, result) => {
        assert.ifError(error);
        const call2 = client.unaryCall({}, metadata, {credentials}, (error, result) => {
          assert.ifError(error);
          done();
        });
        call2.on('metadata', (metadata) => {
          assert.deepEqual(metadata.get('x-grpc-test-echo-initial'),
                          ['test_initial_metadata_value']);
          done();
        });
        call2.on('status', function(status) {
          var echo_trailer = status.metadata.get('x-grpc-test-echo-trailing-bin');
          assert(echo_trailer.length === 1);
          assert.strictEqual(echo_trailer[0].toString('hex'), 'ababab');
          done();
        });
      });
      call1.on('metadata', (metadata) => {
        assert.deepEqual(metadata.get('x-grpc-test-echo-initial'),
                        ['test_initial_metadata_value']);
        done();
      });
      call1.on('status', function(status) {
        var echo_trailer = status.metadata.get('x-grpc-test-echo-trailing-bin');
        assert(echo_trailer.length === 1);
        assert.strictEqual(echo_trailer[0].toString('hex'), 'ababab');
        done();
      });
    });
  });
});