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


const { isValidRequestBody, checkActivityAndAssignee } = require('./helper');
const { code } = require('../../admin/responses');
const { httpsActions } = require('../../admin/constants');
const {
  db,
  deleteField,
  rootCollections,
  getGeopointObject,
} = require('../../admin/admin');
const {
  handleError,
  sendResponse,
} = require('../../admin/utils');


const toAttachmentValues = (activity) => {
  const object = {
    activityId: activity.id,
    createTime: activity.createTime,
  };

  const fields = Object.keys(activity.get('attachment'));

  fields
    .forEach((field) => {
      object[field] = activity.get('attachment')[field].value;
    });

  return object;
};


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
      status: conn.req.body.status,
      timestamp: Date.now(),
    }, {
      merge: true,
    });

  const now = new Date();

  batch.set(addendumDocRef, {
    timestamp: Date.now(),
    date: now.getDate(),
    month: now.getMonth(),
    year: now.getFullYear(),
    dateString: now.toDateString(),
    activityData: Object.assign({}, activity.data(), {
      addendumDocRef,
      status: conn.req.body.status,
      timestamp: Date.now(),
    }),
    user: conn.requester.phoneNumber,
    action: httpsActions.changeStatus,
    status: conn.req.body.status,
    location: getGeopointObject(conn.req.body.geopoint),
    userDeviceTimestamp: conn.req.body.timestamp,
    activityId: conn.req.body.activityId,
    activityName: activity.get('activityName'),
    isSupportRequest: conn.requester.isSupportRequest,
    geopointAccuracy: conn.req.body.geopoint.accuracy || null,
    provider: conn.req.body.geopoint.provider || null,
  });


  if (activity.get('template') === 'employee') {
    if (conn.req.body.status === 'CANCELLED') {
      batch.set(rootCollections
        .offices.doc(activity.get('officeId')), {
          employeesData: {
            [activity.get('attachment.Employee Contact.value')]: deleteField(),
          },
          namesMap: {
            employee: {
              [activity.get('attachment.Name.value')]: deleteField(),
            },
          },
        }, {
          merge: true,
        });
    } else {
      batch.set(rootCollections
        .offices.doc(activity.get('officeId')), {
          employeesData: {
            [activity.get('attachment.Employee Contact.value')]: toAttachmentValues(activity),
          },
          namesMap: {
            employee: {
              [activity.get('attachment.Name.value')]: activity.get('attachment.Name.value'),
            },
          },
        }, {
          merge: true,
        });
    }
  }

  batch
    .commit()
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));
};


const handleResult = (conn, docs) => {
  const result = checkActivityAndAssignee(
    docs,
    conn.requester.isSupportRequest
  );

  if (!result.isValid) {
    sendResponse(conn, code.badRequest, result.message);

    return;
  }

  const [activity] = docs;

  if (activity.get('status') === conn.req.body.status) {
    sendResponse(
      conn,
      code.conflict,
      `The activity status is already '${conn.req.body.status}'.`
    );

    return;
  }

  const template = activity.get('template');
  const attachment = activity.get('attachment');
  const hasName = attachment.hasOwnProperty('Name');
  const officeId = activity.get('officeId');

  if (!hasName || conn.req.body.status !== 'CANCELLED') {
    createDocs(conn, activity);

    return;
  }

  rootCollections
    .offices
    .doc(officeId)
    .collection('Activities')
    .where('template', '==', template)
    .where('attachment.Name.value', attachment.Name.value)
    .where('isCancelled', '==', false)
    .limit(2)
    .get()
    .then((docs) => {
      if (docs.size > 1) {
        sendResponse(conn, code.conflict, `Not allowed`);

        return;
      }

      createDocs(conn, activity);

      return;
    })
    .catch((error) => handleError(conn, error));
};


module.exports = (conn) => {
  if (conn.req.method !== 'PATCH') {
    sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for /change-status`
      + ' endpoint. Use PATCH'
    );

    return;
  }

  const result = isValidRequestBody(conn.req.body, httpsActions.changeStatus);

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
    .then((docs) => handleResult(conn, docs))
    .catch((error) => handleError(conn, error));
};
