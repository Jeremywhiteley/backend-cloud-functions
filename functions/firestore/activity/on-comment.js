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


const { isValidRequestBody } = require('./helper');
const { code } = require('../../admin/responses');
const { httpsActions } = require('../../admin/constants');
const {
  db,
  rootCollections,
  serverTimestamp,
  getGeopointObject,
} = require('../../admin/admin');
const {
  handleError,
  sendResponse,
} = require('../../admin/utils');


const createDocs = (conn, activity) => {
  const batch = db.batch();

  const addendumDocRef = rootCollections
    .offices
    .doc(activity.get('officeId'))
    .collection('Addendum')
    .doc();

  batch.set(rootCollections
    .activities
    .doc(conn.req.body.activityId), {
      addendumDocRef,
      timestamp: serverTimestamp,
    }, {
      merge: true,
    });

  batch.set(addendumDocRef, {
    user: conn.requester.phoneNumber,
    action: httpsActions.comment,
    comment: conn.req.body.comment,
    location: getGeopointObject(conn.req.body.geopoint),
    timestamp: serverTimestamp,
    userDeviceTimestamp: conn.req.body.timestamp,
    activityId: conn.req.body.activityId,
    isSupportRequest: conn.requester.isSupportRequest,
    activityData: activity.data(),
  });

  batch
    .commit()
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));
};


module.exports = (conn) => {
  if (conn.req.method !== 'POST') {
    sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for '${conn.req.url}'`
      + ' endpoint. Use POST.'
    );

    return;
  }

  const result = isValidRequestBody(conn.req.body, httpsActions.comment);

  if (!result.isValid) {
    sendResponse(
      conn,
      code.badRequest,
      result.message
    );

    return;
  }

  Promise
    .all([
      rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .get(),
      rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .collection('Assignees')
        .doc(conn.requester.phoneNumber)
        .get(),
    ])
    .then((docs) => {
      const [
        activity,
        assignee,
      ] = docs;

      if (!activity.exists) {
        sendResponse(conn, code.badRequest, `The activity does not exist`);

        return;
      }

      if (!assignee.exists) {
        sendResponse(conn, code.forbidden, `You cannot edit this activity.`);

        return;
      }

      createDocs(conn, activity);

      return;
    })
    .catch((error) => handleError(conn, error));
};
