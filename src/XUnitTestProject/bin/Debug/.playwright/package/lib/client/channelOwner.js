"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ChannelOwner = void 0;
var _events = require("events");
var _validator = require("../protocol/validator");
var _debugLogger = require("../common/debugLogger");
var _stackTrace = require("../utils/stackTrace");
var _utils = require("../utils");
var _zones = require("../utils/zones");
var _locatorGenerators = require("../utils/isomorphic/locatorGenerators");
/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the 'License");
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

class ChannelOwner extends _events.EventEmitter {
  constructor(parent, type, guid, initializer, instrumentation) {
    var _this$_parent;
    super();
    this._connection = void 0;
    this._parent = void 0;
    this._objects = new Map();
    this._type = void 0;
    this._guid = void 0;
    this._channel = void 0;
    this._initializer = void 0;
    this._logger = void 0;
    this._instrumentation = void 0;
    this._eventToSubscriptionMapping = new Map();
    this.setMaxListeners(0);
    this._connection = parent instanceof ChannelOwner ? parent._connection : parent;
    this._type = type;
    this._guid = guid;
    this._parent = parent instanceof ChannelOwner ? parent : undefined;
    this._instrumentation = instrumentation || ((_this$_parent = this._parent) === null || _this$_parent === void 0 ? void 0 : _this$_parent._instrumentation);
    this._connection._objects.set(guid, this);
    if (this._parent) {
      this._parent._objects.set(guid, this);
      this._logger = this._parent._logger;
    }
    this._channel = this._createChannel(new _events.EventEmitter());
    this._initializer = initializer;
  }
  _setEventToSubscriptionMapping(mapping) {
    this._eventToSubscriptionMapping = mapping;
  }
  _updateSubscription(event, enabled) {
    const protocolEvent = this._eventToSubscriptionMapping.get(String(event));
    if (protocolEvent) this._channel.updateSubscription({
      event: protocolEvent,
      enabled
    }).catch(() => {});
  }
  on(event, listener) {
    if (!this.listenerCount(event)) this._updateSubscription(event, true);
    super.on(event, listener);
    return this;
  }
  addListener(event, listener) {
    if (!this.listenerCount(event)) this._updateSubscription(event, true);
    super.addListener(event, listener);
    return this;
  }
  prependListener(event, listener) {
    if (!this.listenerCount(event)) this._updateSubscription(event, true);
    super.prependListener(event, listener);
    return this;
  }
  off(event, listener) {
    super.off(event, listener);
    if (!this.listenerCount(event)) this._updateSubscription(event, false);
    return this;
  }
  removeListener(event, listener) {
    super.removeListener(event, listener);
    if (!this.listenerCount(event)) this._updateSubscription(event, false);
    return this;
  }
  _adopt(child) {
    child._parent._objects.delete(child._guid);
    this._objects.set(child._guid, child);
    child._parent = this;
  }
  _dispose() {
    // Clean up from parent and connection.
    if (this._parent) this._parent._objects.delete(this._guid);
    this._connection._objects.delete(this._guid);

    // Dispose all children.
    for (const object of [...this._objects.values()]) object._dispose();
    this._objects.clear();
  }
  _debugScopeState() {
    return {
      _guid: this._guid,
      objects: Array.from(this._objects.values()).map(o => o._debugScopeState())
    };
  }
  _createChannel(base) {
    const channel = new Proxy(base, {
      get: (obj, prop) => {
        if (typeof prop === 'string') {
          const validator = (0, _validator.maybeFindValidator)(this._type, prop, 'Params');
          if (validator) {
            return params => {
              return this._wrapApiCall(apiZone => {
                const {
                  stackTrace,
                  csi,
                  callCookie,
                  wallTime
                } = apiZone.reported ? {
                  csi: undefined,
                  callCookie: undefined,
                  stackTrace: null,
                  wallTime: undefined
                } : apiZone;
                apiZone.reported = true;
                if (csi && stackTrace && stackTrace.apiName) csi.onApiCallBegin(renderCallWithParams(stackTrace.apiName, params), stackTrace, wallTime, callCookie);
                return this._connection.sendMessageToServer(this, this._type, prop, validator(params, '', {
                  tChannelImpl: tChannelImplToWire,
                  binary: this._connection.isRemote() ? 'toBase64' : 'buffer'
                }), stackTrace, wallTime);
              });
            };
          }
        }
        return obj[prop];
      }
    });
    channel._object = this;
    return channel;
  }
  async _wrapApiCall(func, isInternal = false) {
    const logger = this._logger;
    const stack = (0, _stackTrace.captureRawStack)();
    const apiZone = _zones.zones.zoneData('apiZone', stack);
    if (apiZone) return func(apiZone);
    const stackTrace = (0, _stackTrace.captureLibraryStackTrace)(stack);
    if (isInternal) delete stackTrace.apiName;

    // Enclosing zone could have provided the apiName and wallTime.
    const expectZone = _zones.zones.zoneData('expectZone', stack);
    const wallTime = expectZone ? expectZone.wallTime : Date.now();
    if (!isInternal && expectZone) stackTrace.apiName = expectZone.title;
    const csi = isInternal ? undefined : this._instrumentation;
    const callCookie = {};
    const {
      apiName,
      frameTexts
    } = stackTrace;
    try {
      logApiCall(logger, `=> ${apiName} started`, isInternal);
      const apiZone = {
        stackTrace,
        isInternal,
        reported: false,
        csi,
        callCookie,
        wallTime
      };
      const result = await _zones.zones.run('apiZone', apiZone, async () => {
        return await func(apiZone);
      });
      csi === null || csi === void 0 ? void 0 : csi.onApiCallEnd(callCookie);
      logApiCall(logger, `<= ${apiName} succeeded`, isInternal);
      return result;
    } catch (e) {
      const innerError = (process.env.PWDEBUGIMPL || (0, _utils.isUnderTest)()) && e.stack ? '\n<inner error>\n' + e.stack : '';
      if (apiName && !apiName.includes('<anonymous>')) e.message = apiName + ': ' + e.message;
      const stackFrames = '\n' + frameTexts.join('\n') + innerError;
      if (stackFrames.trim()) e.stack = e.message + stackFrames;else e.stack = '';
      csi === null || csi === void 0 ? void 0 : csi.onApiCallEnd(callCookie, e);
      logApiCall(logger, `<= ${apiName} failed`, isInternal);
      throw e;
    }
  }
  _toImpl() {
    var _this$_connection$toI, _this$_connection;
    return (_this$_connection$toI = (_this$_connection = this._connection).toImpl) === null || _this$_connection$toI === void 0 ? void 0 : _this$_connection$toI.call(_this$_connection, this);
  }
  toJSON() {
    // Jest's expect library tries to print objects sometimes.
    // RPC objects can contain links to lots of other objects,
    // which can cause jest to crash. Let's help it out
    // by just returning the important values.
    return {
      _type: this._type,
      _guid: this._guid
    };
  }
}
exports.ChannelOwner = ChannelOwner;
function logApiCall(logger, message, isNested) {
  if (isNested) return;
  if (logger && logger.isEnabled('api', 'info')) logger.log('api', 'info', message, [], {
    color: 'cyan'
  });
  _debugLogger.debugLogger.log('api', message);
}
const paramsToRender = ['url', 'selector', 'text', 'key'];
function renderCallWithParams(apiName, params) {
  const paramsArray = [];
  if (params) {
    for (const name of paramsToRender) {
      if (!(name in params)) continue;
      let value;
      if (name === 'selector' && (0, _utils.isString)(params[name]) && params[name].startsWith('internal:')) {
        const getter = (0, _locatorGenerators.asLocator)('javascript', params[name], false, true);
        apiName = apiName.replace(/^locator\./, 'locator.' + getter + '.');
        apiName = apiName.replace(/^page\./, 'page.' + getter + '.');
        apiName = apiName.replace(/^frame\./, 'frame.' + getter + '.');
      } else {
        value = params[name];
        paramsArray.push(value);
      }
    }
  }
  const paramsText = paramsArray.length ? '(' + paramsArray.join(', ') + ')' : '';
  return apiName + paramsText;
}
function tChannelImplToWire(names, arg, path, context) {
  if (arg._object instanceof ChannelOwner && (names === '*' || names.includes(arg._object._type))) return {
    guid: arg._object._guid
  };
  throw new _validator.ValidationError(`${path}: expected channel ${names.toString()}`);
}