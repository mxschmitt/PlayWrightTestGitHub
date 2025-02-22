"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PipeTransport = exports.IpcTransport = void 0;
var _utils = require("../utils");
/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

class PipeTransport {
  constructor(pipeWrite, pipeRead, closeable, endian = 'le') {
    this._pipeWrite = void 0;
    this._data = Buffer.from([]);
    this._waitForNextTask = (0, _utils.makeWaitForNextTask)();
    this._closed = false;
    this._bytesLeft = 0;
    this.onmessage = void 0;
    this.onclose = void 0;
    this._endian = void 0;
    this._closeableStream = void 0;
    this._pipeWrite = pipeWrite;
    this._endian = endian;
    this._closeableStream = closeable;
    pipeRead.on('data', buffer => this._dispatch(buffer));
    pipeRead.on('close', () => {
      this._closed = true;
      if (this.onclose) this.onclose();
    });
    this.onmessage = undefined;
    this.onclose = undefined;
  }
  send(message) {
    if (this._closed) throw new Error('Pipe has been closed');
    const data = Buffer.from(message, 'utf-8');
    const dataLength = Buffer.alloc(4);
    if (this._endian === 'be') dataLength.writeUInt32BE(data.length, 0);else dataLength.writeUInt32LE(data.length, 0);
    this._pipeWrite.write(dataLength);
    this._pipeWrite.write(data);
  }
  close() {
    // Let it throw.
    this._closeableStream.close();
  }
  _dispatch(buffer) {
    // print every byte in buffer
    for (var i = 0; i < buffer.length; i++) {
        console.error("buffer[" + i + "]: " + buffer[i])
    }
    console.error("from driver", buffer.length, buffer.toString('utf-8'))
    // if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    //   // It's a BOM
    //   buffer = buffer.slice(3);
    // }

    this._data = Buffer.concat([this._data, buffer]);
    while (true) {
        console.error("driver transport1")
        if (!this._bytesLeft && this._data.length < 4) {
        console.error("driver transport2")
        // Need more data.
        break;
      }
        console.error("driver transport3")
        if (!this._bytesLeft) {
        console.error("driver transport4")
        console.error(this._data[0], this._data[1], this._data[2], this._data[3])
        this._bytesLeft = this._endian === 'be' ? this._data.readUInt32BE(0) : this._data.readUInt32LE(0);
        console.error("driver transport4.1", this._endian, this._bytesLeft)
        this._data = this._data.slice(4);
      }
      if (!this._bytesLeft || this._data.length < this._bytesLeft) {
        console.error("driver transport5")
        // Need more data.
        break;
      }
        console.error("driver transport6")
        const message = this._data.slice(0, this._bytesLeft);
      this._data = this._data.slice(this._bytesLeft);
      this._bytesLeft = 0;
      this._waitForNextTask(() => {
        if (this.onmessage) this.onmessage(message.toString('utf-8'));
      });
    }
  }
}
exports.PipeTransport = PipeTransport;
class IpcTransport {
  constructor(process) {
    this._process = void 0;
    this._waitForNextTask = (0, _utils.makeWaitForNextTask)();
    this.onmessage = void 0;
    this.onclose = void 0;
    this._process = process;
    this._process.on('message', message => this._waitForNextTask(() => {
      var _this$onclose, _this$onmessage;
      if (message === '<eof>') (_this$onclose = this.onclose) === null || _this$onclose === void 0 ? void 0 : _this$onclose.call(this);else (_this$onmessage = this.onmessage) === null || _this$onmessage === void 0 ? void 0 : _this$onmessage.call(this, message);
    }));
  }
  send(message) {
    this._process.send(message);
  }
  close() {
    this._process.send('<eof>');
  }
}
exports.IpcTransport = IpcTransport;