/**
 * Copyright (c) 2018 GrowthFile
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 *
 */


'use strict';


const { code, } = require('./responses');

const {
  users,
  rootCollections,
  serverTimestamp,
} = require('./admin');


/**
 * Ends the response by sending the `JSON` to the client with `200 OK` response.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} json The response object to send to the client.
 * @param {number} [responseCode] Response code (`default`: `200`) to send to the client.
 * @returns {void}
 */
const sendJSON = (conn, json, responseCode = code.ok) => {
  conn.res.writeHead(responseCode, conn.headers);
  conn.res.end(JSON.stringify(json));
};


/**
 * Ends the response of the request after successful completion of the task
 * or on an error.
 *
 * @param {Object} conn Object containing Express's Request and Response objects.
 * @param {number} statusCode A standard HTTP status code.
 * @param {string} [message] Response message for the request.
 * @returns {void}
 */
const sendResponse = (conn, statusCode, message = '') => {
  let success = true;

  /** 2xx codes denote success. */
  if (statusCode > 226) success = false;

  conn.res.writeHead(statusCode, conn.headers);
  conn.res.end(JSON.stringify({ success, message, code: statusCode, }));
};


/**
 * Ends the response when there is an error while handling the request.
 *
 * @param {Object} conn Object containing Express's Request and Response objects.
 * @param {Object} error Firebase Error object.
 * @returns {void}
 */
const handleError = (conn, error) => {
  console.error(error);

  sendResponse(
    conn,
    code.internalServerError,
    'There was an error handling the request. Please try again later.'
  );
};


/**
 * Helper function to check `support` custom claims.
 *
 * @param {Object} customClaims Contains boolean custom claims.
 * @returns {boolean} If the user has `support` claims.
 */
const hasSupportClaims = (customClaims) => {
  if (!customClaims) return false;

  /** A custom claim can be undefined or a boolean, so an explicit
   * check is used.
   */
  return customClaims.support === true;
};


/**
 * Helper function to check `manageTemplates` custom claims.
 *
 * @param {Object} customClaims Contains boolean custom claims.
 * @returns {boolean} If the user has `ManageTemplate` claims.
 */
const hasManageTemplateClaims = (customClaims) => {
  if (!customClaims) return false;

  /** A custom claim can be undefined or a boolean, so an explicit
   * check is used.
   */
  return customClaims.manageTemplates === true;
};


/**
 * Helper function to check `superUser` custom claims.
 *
 * @param {Object} customClaims Contains boolean custom claims.
 * @returns {boolean} If the user has `superUser` claims.
 */
const hasSuperUserClaims = (customClaims) => {
  if (!customClaims) return false;

  /** A custom claim can be `undefined` or a `boolean`, so an explicit
   * check is used.
   */
  return customClaims.superUser === true;
};


/**
 * Returns the server timestamp on a `GET` request.
 *
 * @param {Object} conn Object containing Express's Request and Response objects.
 * @returns {void}
 */
const now = (conn) => {
  if (conn.req.method !== 'GET') {
    sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for the /now endpoint.`
    );

    return;
  }

  /** Ends response. */
  sendJSON(conn, { success: true, timestamp: Date.now(), code: code.ok, });
};


/**
 * Returns the date in ISO 8601 (DD-MM-YYYY) format.
 *
 * @param {Object} date A valid Date object.
 * @returns {String} An ISO 8601 (DD-MM-YYYY) date string.
 * @see https://en.wikipedia.org/wiki/ISO_8601
 */
const getISO8601Date = (date) =>
  require('moment')(date || new Date())
    .format('DD-MM-YYYY');


const isHHMMFormat = (string) =>
  new RegExp('^([0-9]|0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$').test(string);

/**
 * Disables the user account in auth based on uid and writes the reason to
 * the document in the profiles collection for which the account was disabled.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {string} reason For which the account is being disabled.
 * @returns {void}
 */
const disableAccount = (conn, reason) => {
  const { reportingActions, } = require('../admin/constants');
  const date = new Date();

  const docId = getISO8601Date(date);

  const disabledFor = reason;
  const disabledTimestamp = serverTimestamp;

  const subject = `User Disabled: '${conn.requester.phoneNumber}'`;
  const messageBody = `
  <p>
    The user '${conn.requester.phoneNumber}' has been disabled in Growthfile.
    <br>
    <strong>Reason</strong>: ${reason}
    <br>
    <strong>Timestamp</strong>: ${new Date().toTimeString()} Today
  </p>
  `;

  Promise
    .all([
      rootCollections
        .dailyDisabled
        .doc(docId)
        .set({
          [conn.requester.phoneNumber]: { reason, disabledTimestamp, },
        }, {
            /** This doc may have other fields too. */
            merge: true,
          }),
      rootCollections
        .profiles
        .doc(conn.requester.phoneNumber)
        .set({
          disabledFor,
          disabledTimestamp,
        }, {
            /** This doc may have other fields too. */
            merge: true,
          }),
      rootCollections
        .instant
        .doc()
        .set({
          messageBody,
          subject,
          action: reportingActions.authDisabled,
        }),
      users
        .disableUser(conn.requester.uid),
    ])
    .then(() => sendResponse(
      conn,
      code.forbidden,
      'Your account has been disabled. Please contact support.'
    ))
    .catch((error) => handleError(conn, error));
};


/**
 * Checks if the location is valid with respect to the standard
 * lat and lng values.
 *
 * @param {Object} location Contains `lat` and `lng` values.
 * @returns {boolean} If the input `latitude` & `longitude` pair is valid.
 */
const isValidGeopoint = (location) => {
  if (!location) return false;

  if (!location.hasOwnProperty('latitude')) return false;

  if (!location.hasOwnProperty('longitude')) return false;

  const lat = location.latitude;
  const lng = location.longitude;

  if (typeof lat !== 'number') return false;

  if (typeof lng !== 'number') return false;

  /** @see https://msdn.microsoft.com/en-in/library/aa578799.aspx */
  if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return false;

  return true;
};


/**
 * Checks for a `non-null`, `non-empty` string.
 *
 * @param {string} str A string.
 * @returns {boolean} If `str` is a non-empty string.
 */
const isNonEmptyString = (str) => {
  if (typeof str !== 'string') return false;
  if (str.trim() === '') return false;

  return true;
};


/**
 * Checks whether the number is a valid Unix timestamp.
 *
 * @param {Object} date Javascript Date object.
 * @returns {boolean} Whether the number is a *valid* Unix timestamp.
 */
const isValidDate = (date) => !isNaN(new Date(parseInt(date)));


/**
 * Verifies a phone number based on the E.164 standard.
 *
 * @param {string} phoneNumber A phone number.
 * @returns {boolean} If the string is a *valid* __E.164__ phone number.
 * @see https://en.wikipedia.org/wiki/E.164
 * @see https://stackoverflow.com/a/23299989
 * @description RegExp *Explained*...
 * * `^`: Matches the beginning of the string, or the beginning of a line if the multiline flag (m) is enabled.
 * * `\+`: Matches the `+` character
 * * `[1-9]`: Matches the character in range `1` to `9`
 * * `\d`: Matches any digit character
 * * `{5-14}`: Match between 5 and 14 characters after the preceding `+` token
 * * `$`: Matches the end of the string, or the end of a line if the multiple
 * flag (m) is enabled.
 */
const isE164PhoneNumber = (phoneNumber) =>
  /^\+[1-9]\d{5,14}$/.test(phoneNumber);


module.exports = {
  now,
  sendJSON,
  isValidDate,
  handleError,
  sendResponse,
  isHHMMFormat,
  disableAccount,
  getISO8601Date,
  isValidGeopoint,
  hasSupportClaims,
  isNonEmptyString,
  isE164PhoneNumber,
  hasSuperUserClaims,
  hasManageTemplateClaims,
};
