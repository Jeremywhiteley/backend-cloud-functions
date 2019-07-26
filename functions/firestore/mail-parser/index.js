'use strict';

const {
  users,
  auth,
} = require('../../admin/admin');
const {
  sendJSON,
  multipartParser,
} = require('../../admin/utils');
const {
  code,
} = require('../../admin/responses');
const XLSX = require('xlsx');
const env = require('../../admin/env');


const getEmail = from => {
  // TODO: Replace this with the following:
  // Foo Bar <foo.bar@gmail.com>'.split(/[<>]/);
  const emailFromSendgrid = Buffer.from(from).toString();
  const emailParts = /<(.*?)>/.exec(emailFromSendgrid);

  return emailParts[1];
};

/**
 * Checks custom claims and returns a boolean depending
 * on the custom claims of the user.
 *
 * @param {object} customClaims Custom claims object
 * @param {string} officeName Name of the office
 * @returns {boolean} if the user is support or has admin claims
 * with the specified office
 */
const toAllowRequest = (customClaims, officeName) => {
  if (customClaims) {
    /** Not admin and not support */
    if (!customClaims.admin
      && !customClaims.support) {
      return false;
    }

    /** Is admin but not an admin of the specified office */
    if (customClaims.admin
      && !customClaims.admin.includes(officeName)) {
      return false;
    }

    return true;
  }

  return false;
};

const getAuth = async phoneNumber => {
  try {
    return await auth.getUserByEmail(phoneNumber);
  } catch (error) {
    return {
      phoneNumber,
    };
  }
};


module.exports = async conn => {
  if (conn.req.query.token
    !== env.sgMailParseToken) {
    return {
      success: false,
      code: code.unauthorized,
      message: 'Missing the parse token',
    };
  }

  // body is of type buffer
  const parsedData = multipartParser(conn.req.body, conn.req.headers['content-type']);
  const attachmentInfo = Buffer.from(parsedData['attachment-info']).toString();
  const fullFileName = JSON.parse(attachmentInfo).attachment1.filename;
  const excelFile = parsedData[fullFileName];
  const xlsxFile = Buffer.from(excelFile);
  const workbook = XLSX.read(xlsxFile);
  const sheet1 = workbook.SheetNames[0];
  const theSheet = workbook.Sheets[sheet1];
  const arrayOfObjects = XLSX
    .utils
    .sheet_to_json(theSheet, {
      blankrows: true,
      defval: '',
      raw: false,
    });

  arrayOfObjects
    .forEach((_, index) => {
      if (Array.isArray(arrayOfObjects[index].share)) {
        return;
      }

      arrayOfObjects[index].share = [];
    });

  // Reset the body and creating custom object for consumption
  // by the bulk creation function
  const attachmentNameParts = fullFileName.split('--');

  conn.req.body = {
    data: arrayOfObjects,
    timestamp: Date.now(),
    senderEmail: getEmail(parsedData.from),
    template: attachmentNameParts[0]
      .trim()
      .toLowerCase(),
    office: attachmentNameParts[1]
      .split('.xlsx')[0]
      .trim(),
    geopoint: {
      latitude: 28.5463443,
      longitude: 77.2519989,
    },
  };

  const userRecord = await getAuth(conn.req.body.senderEmail);
  const {
    customClaims
  } = userRecord;

  if (!toAllowRequest(customClaims, conn.req.body.office)) {
    return {
      code: code.unauthorized,
      message: 'Unknown user',
      success: false,
    };
  }

  conn.requester = {
    isSupportRequest: false,
    email: conn.req.body.senderEmail || '',
    uid: userRecord.uid,
    phoneNumber: userRecord.phoneNumber,
    displayName: userRecord.displayName || '',
    customClaims: userRecord.customClaims,
  };

  return await require('../firestore/bulk/script')(conn);
};
