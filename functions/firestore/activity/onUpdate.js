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
  handleError,
  sendResponse,
} = require('../../admin/utils');

const {
  handleCanEdit,
  isValidDate,
  isValidString,
  isValidLocation,
  isValidPhoneNumber,
  scheduleCreator,
  venueCreator,
} = require('./helperLib');

const {
  activities,
  profiles,
  updates,
  enums,
  activityTemplates,
} = rootCollections;


/**
 * Commits the batch and sends a response to the client of the result.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 */
const commitBatch = (conn) => conn.batch.commit()
  .then((data) => sendResponse(conn, 202, 'ACCEPTED'))
  .catch((error) => handleError(conn, error));


/**
 * Adds the activity root data to the batch.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @param {Array} result Array of document data objects fetched from Firestore.
 */
const writeActivityRoot = (conn, result) => {
  if (!conn.req.body.description) conn.req.body.description = '';

  conn.batch.set(activities.doc(conn.req.body.activityId), {
    title: conn.req.body.title || result[0].get('title'),
    description: conn.req.body.description ||
      result[0].get('description'),
    status: result[1].get(ACTIVITYSTATUS).indexOf(conn.req.body.status) > -1 ?
      conn.req.body.status : result[0].get('status'),
    schedule: scheduleCreator(
      conn.req.body.schedule,
      conn.templateData.schedule
    ),
    venue: venueCreator(
      conn.req.body.schedule,
      conn.templateData.venue
    ),
    timestamp: new Date(conn.req.body.timestamp),
    /** docRef is the the doc which the activity handled in the request */
    docRef: conn.docRef,
  }, {
      /** in some requests, the data coming from the request will be
       * partial, so we are merging instead of overwriting
       */
      merge: true,
    });

  conn.batch.set(updates.doc(conn.requester.uid)
    .collection('Addendum').doc(), conn.addendumData);

  commitBatch(conn);
};


/**
 * Handles the document creation in /Profiles and addition of new documents in
 * /Updates/<uid>/Activities collection for the assigned users of the acivity.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @param {Array} result Array of document data objects fetched from Firestore.
 */
const processAsigneesList = (conn, result) => {
  if (Array.isArray(conn.req.body.unassign)) {
    conn.req.body.unassign.forEach((val) => {
      if (!isValidPhoneNumber(val)) return;

      conn.batch.delete(activities.doc(conn.req.body.activityId)
        .collection('Assignees').doc(val));

      conn.batch.delete(profiles.doc(val).collection('Activities')
        .doc(conn.req.body.activityId));
    });
  }

  const promises = [];

  if (Array.isArray(conn.req.body.assign)) {
    conn.req.body.assign.forEach((val) => {
      if (!isValidPhoneNumber(val)) return;

      conn.batch.set(activities.doc(conn.req.body.activityId)
        .collection('Assignees').doc(val), {
          canEdit: handleCanEdit(conn.templateData.canEditRule),
        });

      conn.batch.set(profiles.doc(val).collection('Activities')
        .doc(conn.req.body.activityId), {
          canEdit: handleCanEdit(conn.templateData.canEditRule),
          timestamp: new Date(conn.req.body.timestamp),
        });

      promises.push(profiles.doc(val).get());
    });
  }

  Promise.all(promises).then((snapShots) => {
    snapShots.forEach((doc) => {
      /** uid shouldn't be undefined or null and the doc shouldn't be of
       * a person who has been unassigned from the activity during the update
       */
      if (doc.get('uid') && conn.req.body.unassign.indexOf(doc.id) === -1) {
        conn.batch.set(updates.doc(doc.get('uid')).collection('Addendum')
          .doc(), conn.addendumData);
      }
    });

    writeActivityRoot(conn, result);
    return;
  }).catch((error) => handleError(conn, error));
};


/**
 * Fetches the assignees list and the template from the Activity in context.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @param {Array} result Array of document data objects fetched from Firestore.
 */
const getTemplateAndAssigneesFromActivity = (conn, result) => {
  const templateRef = activityTemplates.doc(result[0].get('template')).get();
  const assignToCollectionRef = activities.doc(conn.req.body.activityId)
    .collection('AssignTo').get();

  Promise.all([templateRef, assignToCollectionRef])
    .then((docsFromFirestore) => {
      conn.templateData = docsFromFirestore[0].data();

      conn.activityAssignees = [];

      docsFromFirestore[1].forEach((doc) =>
        conn.activityAssignees.push(doc.id));

      conn.addendumData = {
        activityId: conn.req.body.activityId,
        user: conn.requester.displayName || conn.requester.phoneNumber,
        comment: `${conn.requester.displayName || conn.requester.phoneNumber}
        updated ${conn.templateData.name}`,
        location: getGeopointObject(
          conn.req.body.geopoint[0],
          conn.req.body.geopoint[1]
        ),
        timestamp: new Date(conn.req.body.timestamp),
      };

      if (conn.req.body.addAssignTo || conn.req.body.deleteAssignTo) {
        processAsigneesList(conn, result);
        return;
      }

      writeActivityRoot(conn, result);
      return;
    }).catch((error) => handleError(conn, error));
};


const updateSubscription = (conn, result) => {
  /** docRef is required in the activity root */
  conn.docRef = profiles.doc(conn.requester.phoneNumber)
    .collection('Subscriptions').doc();

  conn.batch.set(conn.docRef, {
    include: [conn.requester.phoneNumber],
    timestamp: new Date(conn.req.body.timestamp),
    template: result[1].docs[0].id,
    office: conn.req.body.office,
    activityId: conn.req.body.activityId,
    status: 'CONFIRMED', // ??
  });

  getTemplateAndAssigneesFromActivity(conn, result);
};


const updateCompany = (conn, result) => {
  /** docRef is required in the activity root */
  conn.docRef = offices.doc(conn.req.body.office);

  conn.batch.set(offices.doc(conn.req.body.office), {
    activityId: conn.req.body.activityId,
    attachment: attachmentCreator(conn.req.body.attachment),
  });

  getTemplateAndAssigneesFromActivity(conn, result);
};


const addNewEntityInOffice = (conn, result) => {
  /** docRef is required in the activity root */
  conn.docRef = office.doc(conn.req.body.office)
    .collection(conn.req.body.template).doc();

  conn.batch.set(conn.docRef, {
    attachment: attachmentCreator(conn.req.body.attachment),
    schedule: scheduleCreator(conn.req.body.schedule),
    venue: venueCreator(conn.req.body.venue),
    activityId: conn.req.body.activityId,
    status: 'PENDING',
  });

  getTemplateAndAssigneesFromActivity(conn, result);
};


const processRequestType = (conn, result) => {
  /** reference of the batch instance will be used
   * multiple times throughout the activity creation */
  conn.batch = db.batch();

  if (conn.req.body.office === 'personal' &&
    conn.req.body.template === 'plan') {
    sendResponse(conn, 401, 'You can\'t edit the Office: personal' +
      'and the Template: plan');
    return;
  }

  if (conn.req.body.office !== 'personal') {
    if (conn.req.body.template === 'subscription') {
      updateSubscription(conn, result);
      return;
    }

    if (conn.req.body.template === 'company') {
      updateCompany(conn, result);
      return;
    }
  }

  addNewEntityInOffice(conn, result);
};

/**
 * Fetches the activtiy root and enum/activitytemplates doc.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 */
const fetchDocs = (conn) => {
  const promises = [
    activities.doc(conn.req.body.activityId).get(),
    enums.doc('ACTIVITYSTATUS').get(),
  ];

  Promise.all(promises).then((result) => {
    if (!result[0].exists) {
      /** the activity with the id from the request body doesn't
       * exist in the Firestore
       * */
      sendResponse(conn, 409, 'CONFLICT');
      return;
    }

    if (conn.req.body.template || conn.req.body.office) {
      processRequestType(conn, result);
      return;
    }

    getTemplateAndAssigneesFromActivity(conn, result);
    return;
  }).catch((error) => {
    console.log(error);
    sendResponse(conn, 400, 'BAD REQUEST');
  });
};


/**
 * Checks whether the user has the permission to update the activity.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 */
const verifyPermissionToUpdateActivity = (conn) => {
  profiles.doc(conn.requester.phoneNumber).collection('Activities')
    .doc(conn.req.body.activityId).get().then((doc) => {
      if (!doc.exists || !doc.get('canEdit')) {
        /** along with having a document in /Assignees sub-collection,
         * the user must also have the permission to edit the activity
         */
        sendResponse(conn, 403, 'FORBIDDEN');
        return;
      }

      fetchDocs(conn);
      return;
    }).catch((error) => handleError(conn, error));
};


const app = (conn) => {
  if (!isValidDate(conn.req.body.timestamp) ||
    !isValidString(conn.req.body.activityId) ||
    !isValidLocation(conn.req.body.geopoint)) {
    sendResponse(conn, 400, 'BAD REQUEST');
    return;
  }

  verifyPermissionToUpdateActivity(conn);
};

module.exports = app;
