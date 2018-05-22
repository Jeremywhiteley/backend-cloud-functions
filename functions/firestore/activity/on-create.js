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


const {
  rootCollections,
  users,
  getGeopointObject,
  db,
} = require('../../admin/admin');

const {
  activities,
  profiles,
  updates,
  enums,
  activityTemplates,
  offices,
} = rootCollections;

const {
  handleError,
  sendResponse,
} = require('../../admin/utils');

const {
  code,
} = require('../../admin/responses');

const {
  handleCanEdit,
  isValidDate,
  isValidString,
  isValidPhoneNumber,
  isValidLocation,
  scheduleCreator,
  venueCreator,
  attachmentCreator,
} = require('./helper');


/**
 * Commits the batch and sends a response to the client.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 */
const commitBatch = (conn) => conn.batch.commit()
  .then((result) => sendResponse(conn, code.created, 'CREATED'))
  .catch((error) => handleError(conn, error));


/**
 * Adds docs for each assignee of the activity to the batch.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} result Contains the fetched documents from Firestore.
 */
const handleAssignedUsers = (conn, result) => {
  const promises = [];

  /**
   * create docs in Assignees collection if assignees is in the
   * reqeuest body
   * */
  conn.req.body.assignees.forEach((val) => {
    if (!isValidPhoneNumber(val)) return;

    conn.batch.set(activities.doc(conn.activityRef.id)
      .collection('Assignees').doc(val), {
        /** template --> result[0] */
        canEdit: handleCanEdit(
          result[1].docs[0].get('canEditRule'),
          val,
          conn.requester.phoneNumber
        ),
      }, {
        merge: true,
      });

    /** phone numbers exist uniquely in the Profiles root collection */
    promises.push(profiles.doc(val).get());

    conn.batch.set(profiles.doc(val).collection('Activities')
      .doc(conn.activityRef.id), {
        canEdit: handleCanEdit(
          result[1].docs[0].get('canEditRule'),
          val,
          conn.requester.phoneNumber
        ),
        timestamp: new Date(conn.req.body.timestamp),
      });
  });

  Promise.all(promises).then((snapShots) => {
    /** The doc exists inside Profiles collection. */
    snapShots.forEach((doc) => {
      if (!doc.exists) {
        /** Create profiles for the phone numbers which are not in the DB. */
        conn.batch.set(profiles.doc(doc.id), {
          uid: null,
        });

        conn.batch.set(profiles.doc(doc.id).collection('Activities')
          .doc(conn.activityRef.id), {
            canEdit: handleCanEdit(
              result[1].docs[0].get('canEditRule'),
              doc.id,
              conn.requester.phoneNumber
            ),
            timestamp: new Date(conn.req.body.timestamp),
          });
      }

      /** uid shouldn't be null OR undefined */
      if (doc.exists && doc.get('uid')) {
        conn.batch.set(updates.doc(doc.get('uid')).collection('Addendum')
          .doc(), conn.addendumData);
      }
    });

    commitBatch(conn, conn.batch);
    return;
  }).catch((error) => handleError(conn, error));
};


/**
 * Adds activity root doc to batch.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @param {Array} result Fetched docs from Firestore.
 */
const createActivity = (conn, result) => {
  /** description is a non-essential field */
  if (!conn.req.body.description) conn.req.body.description = '';

  conn.batch.set(conn.activityRef, {
    title: conn.req.body.title || conn.req.body.description
      .substring(0, 30) || result[0].docs[0].get('defaultTitle'),
    description: conn.req.body.description,
    status: result[0].docs[0].get('statusOnCreate'),
    office: conn.req.body.office,
    template: conn.req.body.template,
    schedule: scheduleCreator(
      conn.req.body.schedule,
      /** schedule object from the template */
      result[0].docs[0].get('schedule')
    ),
    venue: venueCreator(
      conn.req.body.venue,
      /** venue object from the template */
      result[0].docs[0].get('venue')
    ),
    timestamp: new Date(conn.req.body.timestamp),
    /** The docRef is the reference to the document which the
     * activity handled in the request. It will ne null for an
     * activity with the template 'plan' with office 'personal'.
     */
    docRef: conn.docRef || null,
  });

  conn.addendumData = {
    activityId: conn.activityRef.id,
    user: conn.requester.displayName || conn.requester.phoneNumber,
    comment: `${conn.requester.displayName || conn.requester.phoneNumber}
      created ${result[0].docs[0].get('name')}`,
    location: getGeopointObject(conn.req.body.geopoint),
    timestamp: new Date(conn.req.body.timestamp),
  };

  /** The addendum doc is always created for the requester */
  conn.batch.set(updates.doc(conn.requester.uid)
    .collection('Addendum').doc(), conn.addendumData);

  /** The 'include' array will always have the requester's
   * phone number, so we don't need to explictly add their number
   * in order to add them to a batch.
   */
  result[1].docs[0].get('include').forEach((val) => {
    conn.batch.set(activities.doc(conn.activityRef.id)
      .collection('Assignees').doc(val), {
        canEdit: handleCanEdit(
          result[1].docs[0].get('canEditRule'),
          val,
          conn.requester.phoneNumber
        ),
      });
  });

  conn.batch.set(profiles.doc(conn.requester.phoneNumber)
    .collection('Activities').doc(conn.activityRef.id), {
      canEdit: handleCanEdit(
        result[1].docs[0].get('canEditRule'),
        /** The phone Number to check and the one with which we are
         * going to verify the edit rule with are same because this
         * block is writing the doc for the user themselves.
         */
        conn.requester.phoneNumber,
        conn.requester.phoneNumber
      ),
      timestamp: new Date(conn.req.body.timestamp),
    });

  if (Array.isArray(conn.req.body.assignees)) {
    handleAssignedUsers(conn, result);
    return;
  }

  commitBatch(conn);
};


/**
 * Adds subscription to the user's profile based on the request body.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @param {Array} result Fetched docs from Firestore.
 */
const createSubscription = (conn, result) => {
  conn.docRef = profiles.doc(conn.requester.phoneNumber)
    .collection('Subscriptions').doc();

  conn.batch.set(conn.docRef, {
    include: [conn.requester.phoneNumber],
    timestamp: new Date(conn.req.body.timestamp),
    template: result[1].docs[0].id,
    office: conn.req.body.office,
    activityId: conn.activityRef.id,
    status: result[0].docs[0].get('statusOnCreate'),
  });

  createActivity(conn, result);
};


/**
 * Creates a new document inside Office root collection based on the
 * attachment, template, and the request body.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @param {Array} result Fetched docs from Firestore.
 */
const createCompany = (conn, result) => {
  conn.docRef = offices.doc(conn.req.body.office);

  conn.batch.set(conn.docRef, {
    activityId: conn.activityRef.id,
    attachment: attachmentCreator(
      conn.req.body.attachment,
      result[0].docs[0].get('attachment')
    ),
  });

  createActivity(conn, result);
};


/**
 * Creates a new document inside the specified Office from the
 * attachment based on the attachment, template and, the request body.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @param {Array} result Fetched docs from Firestore.
 */
const addNewEntityInOffice = (conn, result) => {
  conn.docRef = office.doc(conn.req.body.office)
    .collection(conn.req.body.template).doc();

  conn.batch.set(conn.docRef, {
    attachment: attachmentCreator(
      conn.req.body.attachment,
      result[0].docs[0].get('attachment')
    ),
    schedule: scheduleCreator(conn.req.body.schedule),
    venue: venueCreator(conn.req.body.venue),
    activityId: conn.activityRef.id,
    status: result[0].docs[0].get('statusOnCreate'),
  });

  createActivity(conn, result);
};


/**
 * Checks the template and office combination and handles the request
 * based on that.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @param {Array} result Fetched docs from Firestore.
 */
const processRequestType = (conn, result) => {
  /** reference of the batch and the activity instance will be used
   * multiple times throughout the activity creation
   */
  conn.activityRef = activities.doc();
  conn.batch = db.batch();

  if (conn.req.body.office === 'personal') {
    if (conn.req.body.template === 'plan') {
      createActivity(conn, result);
      return;
    }

    sendResponse(
      conn,
      code.badRequest,
      'The template and office do not have' + ' a valid combination');
    return;
  } else {
    /** if office is not personal */
    if (result[2].empty) {
      /** office does not exist with the name from the request */
      sendResponse(
        conn,
        code.badRequest,
        'An office with this name does not exist'
      );
      return;
    }

    if (conn.req.body.template === 'subscription') {
      createSubscription(conn, result);
      return;
    }

    if (conn.req.body.template === 'company') {
      createCompany(conn, result);
      return;
    }

    addNewEntityInOffice(conn, result);
  }
};


/**
 * Fetches the template and the subscriptions of the requester form Firestore.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 */
const fetchDocs = (conn) => {
  const promises = [
    activityTemplates.where('name', '==', conn.req.body.template)
      .limit(1).get(),
    profiles.doc(conn.requester.phoneNumber).collection('Subscriptions')
      .where('template', '==', conn.req.body.template).limit(1).get(),
    offices.where('name', '==', conn.req.body.office).limit(1).get(),
    /** The enums doc will always exist. */
    enums.doc('CANEDITRULES').get(),
  ];

  Promise.all(promises).then((result) => {
    /** template sent in the request body is not a doesn't exist */
    if (result[0].empty) {
      sendResponse(
        conn,
        code.badRequest,
        'Template: ' + conn.req.body.template + ' does not exist'
      );
      return;
    }

    if (!result[1].docs[0].exists
      /** Checks if the requester has subscription of this activity. */
      &&
      result[1].docs[0].get('office') !== conn.req.body.office) {
      /** Template from the request body and the office do not match so,
       * the requester probably doesn't have the permission to create
       * an activity with this template.
       */
      sendResponse(
        conn,
        code.forbidden,
        'You do not have the permission to create'
        + ' an activity with this template');
      return;
    }

    processRequestType(conn, result);
    return;
  }).catch((error) => handleError(conn, error));
};


const app = (conn) => {
  if (isValidDate(conn.req.body.timestamp) &&
    isValidString(conn.req.body.template) &&
    isValidString(conn.req.body.office) &&
    isValidLocation(conn.req.body.geopoint)) {
    fetchDocs(conn);
    return;
  }

  sendResponse(
    conn,
    code.badRequest,
    'The request body does not have all the necessary fields with proper'
    + ' values. Please make sure that the timestamp, template, office'
    + ' and the geopoint are included in the request with appropriate values.'
  );
};

module.exports = app;