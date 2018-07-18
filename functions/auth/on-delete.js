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


const {
  rootCollections,
  db,
} = require('../admin/admin');


/**
 * Sets the `uid` and `phoneNumber` fields of the user being deleted to
 * `null` inside the Updates and Profiles collection respectively.
 *
 * @param {Object} userRecord Object with user info.
 * @returns {Promise} Batch object.
 */
const app = (userRecord) => {
  const {
    uid,
    phoneNumber,
  } = userRecord;

  const batch = db.batch();

  batch.set(rootCollections
    .profiles
    .doc(phoneNumber), {
      uid: null,
    }, {
      merge: true,
    }
  );

  batch.set(rootCollections
    .updates
    .doc(uid), {
      phoneNumber: null,
    }, {
      merge: true,
    }
  );

  return batch
    .commit()
    .catch(console.error);
};


module.exports = app;
