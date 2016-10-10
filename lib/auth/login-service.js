'use strict';

const http = require('http');
const co = require('co');
const promisify = require('es6-promisify');
const request = require('request');
const config = require('../../config');
const constants = require('./constants');
const LoginServiceError = require('./login-service-error');

const debug = (() => {
    return ((+process.env.DEBUG_SDK === 1)
        ? console.log.bind(console)
        : () => void(0));
})();

class LoginService {
    constructor(req, res) {
        if (!(req instanceof http.IncomingMessage)) {
            throw new Error('LoginService::req must be instanceof `http.IncomingMessage`');
        }

        if (!(res instanceof http.ServerResponse)) {
            throw new Error('LoginService::res must be instanceof `http.ServerResponse`');
        }

        this.authUrl = config.AUTH_URL;
        this.req = req;
        this.res = res;
    }

    static create(req, res) {
        return new this(req, res);
    }

    login(callback) {
        let promise = promisify(this._login, this)();

        callback = this._checkCallback(callback);
        promise.then(callback.bind(null, null), callback);

        return promise;
    }

    check(callback) {
        let promise = promisify(this._check, this)();

        callback = this._checkCallback(callback);
        promise.then(callback.bind(null, null), callback);

        return promise;
    }

    _login(callback) {
        co.wrap(function *() {
            try {
                let data = this._getLoginData();
                debug('========================================');
                debug('LoginService::login [data] =>', JSON.stringify(data, null, 2));
                debug('========================================\n');

                let result = yield this._sendRequest(data);

                let response = result[0];
                if (response.statusCode !== 200) {
                    throw new Error('请求鉴权 API 失败，网络异常或鉴权服务器错误');
                }

                let body = result[1];
                debug('========================================');
                debug('LoginService::login [result] =>', typeof body === 'object' ? JSON.stringify(body, null, 2) : body);
                debug('========================================\n');

                if (typeof body !== 'object') {
                    throw new Error('鉴权服务器响应格式错误，无法解析 JSON 字符串');
                }

                if (body.returnCode === 0) {
                    let returnData = body.returnData;

                    this._writeJsonResult({
                        [constants.WX_SESSION_MAGIC_ID]: 1,
                        session: {
                            id: returnData.id,
                            skey: returnData.skey,
                        },
                    });

                    callback(null, { 'userInfo': returnData.user_info });
                } else {
                    throw new Error(`#${body.returnCode} - ${body.returnMessage}`);
                }

            } catch (err) {
                callback(new LoginServiceError(constants.ERR_LOGIN_FAILED, err.message));
            }
        }).call(this);
    }

    _check(callback) {
        co.wrap(function *() {
            try {
                let data = this._getCheckData();
                debug('========================================');
                debug('LoginService::check [data] =>', JSON.stringify(data, null, 2));
                debug('========================================\n');

                let result = yield this._sendRequest(data);

                let response = result[0];
                if (response.statusCode !== 200) {
                    throw new Error('请求鉴权 API 失败，网络异常或鉴权服务器错误');
                }

                let body = result[1];
                debug('========================================');
                debug('LoginService::check [result] =>', typeof body === 'object' ? JSON.stringify(body, null, 2) : body);
                debug('========================================\n');

                if (typeof body !== 'object') {
                    throw new Error('鉴权服务器响应格式错误，无法解析 JSON 字符串');
                }

                switch (body.returnCode) {
                case 0:
                    let returnData = body.returnData;
                    callback(null, { 'userInfo': returnData.user_info });
                    break;

                case 60011:
                    throw new LoginServiceError(constants.ERR_SESSION_EXPIRED, body.returnMessage);
                    break;

                default:
                    throw new Error(`#${body.returnCode} - ${body.returnMessage}`);
                    break;
                }

            } catch (err) {
                if (err instanceof LoginServiceError) {
                    callback(err);
                } else {
                    callback(new LoginServiceError(constants.ERR_CHECK_LOGIN_FAILED, err.message));
                }
            }
        }).call(this);
    }

    writeError(err) {
        if (!(err instanceof LoginServiceError)) {
            throw new Error('unknown error passed to LoginService::writeError');
        }

        this._writeJsonResult({
            [constants.WX_SESSION_MAGIC_ID]: 1,
            error: err.type,
            message: err.message,
        });
    }

    _checkCallback(callback) {
        if (!callback) {
            callback = (err) => {
                if (err) {
                    this.writeError(err);
                }
            };
        }

        if (typeof callback !== 'function') {
            throw new Error('`callback` must be a function');
        }

        return callback;
    }

    _writeJsonResult(obj) {
        this.res.writeHead(200, { 'Content-Type': 'application/json' });
        this.res.end(JSON.stringify(obj));
    }

    _sendRequest(data) {
        let params = { 'url': this.authUrl, 'body': data, 'json': true };
        return promisify(request.post, { multiArgs: true })(params);
    }

    _getLoginData() {
        let data = [
            ['code', constants.WX_HEADER_CODE],
            ['encrypt_data', constants.WX_HEADER_ENCRYPT_DATA],
        ].reduce((ret, item) => {
            ret[item[0]] = this._getHeader(item[1]);
            return ret;
        }, {});

        return this._packReqData(constants.INTERFACE_LOGIN, data);
    }

    _getCheckData() {
        let data = [
            ['id', constants.WX_HEADER_ID],
            ['skey', constants.WX_HEADER_SKEY],
        ].reduce((ret, item) => {
            ret[item[0]] = this._getHeader(item[1]);
            return ret;
        }, {});

        return this._packReqData(constants.INTERFACE_CHECK, data);
    }

    _getHeader(headerKey) {
        let key = String(headerKey).toLowerCase();
        return this.req.headers[key] || '';
    }

    _packReqData(interfaceName, data) {
        return {
            'version': 1,
            'componentName': 'MA',
            'interface': {
                'interfaceName': interfaceName,
                'para': data,
            },
        };
    }
}

module.exports = LoginService;