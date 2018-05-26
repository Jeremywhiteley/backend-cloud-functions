const {
  rootCollections,
  getGeopointObject,
  db,
} = require('../../admin/admin');

const {
  handleError,
  sendResponse,
} = require('../../admin/utils');

const {
  isValidDate,
  isValidString,
  isValidLocation,
} = require('./helper');

const {
  code,
} = require('../../admin/responses');

const {
  activities,
  profiles,
  updates,
  activityTemplates,
} = rootCollections;


const commitBatch = (conn) => conn.batch.commit()
  .then((data) => sendResponse(
    conn,
    code.noContent,
    'Activity status was updated successfully.',
    true
  )).catch((error) => handleError(conn, error));


const addAddendumForAssignees = (conn) => {
  Promise.all(conn.data.Assignees).then((docsArray) => {
    docsArray.forEach((doc) => {
      if (doc.get('uid')) {
        conn.batch.set(updates.doc(doc.get('uid'))
          .collection('Addendum').doc(), conn.addendum);
      }
    });

    commitBatch(conn);
    return;
  }).catch((error) => handleError(conn, error));
};

const updateActivityStatus = (conn) => {
  conn.batch.set(activities.doc(conn.req.body.activityId), {
    status: conn.req.body.status,
    timestamp: new Date(conn.req.body.timestamp),
  }, {
      merge: true,
    });

  addAddendumForAssignees(conn);
};

const fetchTemplate = (conn) => {
  activityTemplates.doc(conn.data.activity.get('template')).get()
    .then((doc) => {
      conn.addendum = {
        activityId: conn.req.body.activityId,
        user: conn.requester.displayName || conn.requester.phoneNumber,
        comment: conn.requester.displayName || conn.requester.phoneNumber
          + ' updated ' + doc.get('defaultTitle'),
        location: getGeopointObject(conn.req.body.geopoint),
        timestamp: new Date(conn.req.body.timestamp),
      };

      conn.data.template = doc;
      updateActivityStatus(conn);

      return;
    }).catch((error) => handleError(conn, error));
};


const fetchDocs = (conn) => {
  Promise.all([
    activities.doc(conn.req.body.activityId).get(),
    activities.doc(conn.req.body.activityId).collection('Assignees').get(),
    enums.doc('ACTIVITYSTATUS').get(),
  ]).then((result) => {
    if (!result[0].exists) {
      /** This case should probably never execute becase there is provision
       * for deleting an activity anywhere. AND, for reaching the fetchDocs()
       * function, the check for the existance of the activity has already
       * been performed in the User's profile.
       */
      sendResponse(
        conn,
        code.conflict,
        `There is no activity with the id: ${conn.req.body.activityId}`,
        false
      );
      return;
    }

    conn.batch = db.batch();
    conn.data = {};

    conn.data.Assignees = [];
    conn.data.activity = result[0];

    if (conn.req.body.status === conn.data.activity.get('status')) {
      sendResponse(
        conn,
        code.conflict,
        `The activity status is already ${conn.req.body.status}.`,
        false
      );
      return;
    }

    /** The Assignees list is required to add addendum. */
    result[1].forEach((doc) => {
      conn.data.Assignees.push(profiles.doc(doc.id).get());
    });

    conn.data.statusEnum = result[2].get('ACTIVITYSTATUS');

    if (conn.data.statusEnum.indexOf(conn.req.body.status) === -1) {
      sendResponse(
        conn,
        code.badRequest,
        `${conn.req.body.status} is NOT a valid status from the template.`,
        false
      );
      return;
    }

    fetchTemplate(conn);
    return;
  }).catch((error) => handleError(conn, error));
};

const verifyEditPermission = (conn) => {
  profiles.doc(conn.requester.phoneNumber).collection('Activities')
    .doc(conn.req.body.activityId).get().then((doc) => {
      if (!doc.exists) {
        /** The activity doesn't exist for the user */
        sendResponse(
          conn,
          conn.forbidden,
          `An activity with the id: ${conn.req.body.activityId} doesn't exist.`,
          false
        );
        return;
      }

      if (!doc.get('canEdit')) {
        /** The canEdit flag is false so updating is not allowed */
        sendResponse(
          conn,
          code.forbidden,
          'You do not have the permission to edit this activity.',
          false
        );
        return;
      }

      fetchDocs(conn);
      return;
    }).catch((error) => handleError(conn, error));
};

// share --> assign
const app = (conn) => {
  if (isValidDate(conn.req.body.timestamp)
    && isValidString(conn.req.body.activityId)
    && isValidString(conn.req.body.status)
    && isValidLocation(conn.req.body.geopoint)) {
    verifyEditPermission(conn);
    return;
  }

  sendResponse(
    conn,
    code.badRequest,
    'The request body does not have all the necessary fields with proper'
    + ' values. Please make sure that the timestamp, activityId, status'
    + ' and the geopoint are included in the request with appropriate values.',
    false
  );
};


module.exports = app;