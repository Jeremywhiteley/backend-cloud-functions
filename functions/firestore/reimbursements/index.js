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

const {rootCollections, db} = require('../../admin/admin');
const {
  subcollectionNames,
  dateFormats,
  addendumTypes,
  reimbursementsFrequencies,
} = require('../../admin/constants');
const momentTz = require('moment-timezone');

const getBeneficiaryId = async ({roleDoc, officeId, phoneNumber}) => {
  if (roleDoc && roleDoc.id) {
    return roleDoc.id;
  }

  const [newRole] = (
    await rootCollections.activities
      .where('officeId', '==', officeId)
      .where('status', '==', 'CONFIRMED')
      .where('attachment.Phone Number.value', '==', phoneNumber)
      .get()
  ).docs.filter(doc => {
    const {template} = doc.data();

    return template !== 'admin' && template !== 'subscription';
  });

  if (newRole) {
    return newRole.id;
  }

  // query checkIn subscription doc
  // use that activityId as the role
  const {
    docs: [checkInSubscription],
  } = await rootCollections.activities
    .where('template', '==', 'subscription')
    .where('attachment.Template.value', '==', 'check-in')
    .where('officeId', '==', officeId)
    .where('attachment.Phone Number.value', '==', phoneNumber)
    .limit(1)
    .get();

  return checkInSubscription ? checkInSubscription.id : null;
};

const getDefaultVoucher = ({
  date,
  month,
  year,
  beneficiaryId,
  office,
  officeId,
  amount,
  cycle,
  batchId = null,
}) => ({
  date,
  month,
  year,
  beneficiaryId,
  office,
  officeId,
  amount,
  cycle,
  batchId,
});

const getIterator = ({reimbursementFrequency, date, month, year}) => {
  const momentInstance = momentTz()
    .date(date)
    .month(month)
    .year(year);
  const isBimonthly =
    reimbursementFrequency === reimbursementsFrequencies.BI_MONTHLY;

  return {
    start: (() => {
      if (isBimonthly) {
        return momentInstance.clone().date(1);
      }

      return momentInstance.clone().startOf('month');
    })(),
    end: (() => {
      if (isBimonthly) {
        return momentInstance.clone().date(15);
      }

      return momentInstance.clone().endOf('month');
    })(),
  };
};

const getCycleDates = ({
  isBimonthlyReimbursement: reimbursementFrequency,
  date,
  month,
  year,
}) => {
  const result = [];
  const {start: iteratorStart, end: iteratorEnd} = getIterator({
    reimbursementFrequency,
    date,
    month,
    year,
  });
  const iterator = iteratorStart.clone();

  while (iterator.isSameOrBefore(iteratorEnd)) {
    result.push(iterator.format(dateFormats.DATE));

    iterator.add(1, 'day');
  }

  return result;
};

const reimbursementHandler = async (change, context) => {
  const {after: doc} = change;
  const batch = db.batch();
  const {date, month, year, phoneNumber, roleDoc, office} = doc.data();
  const {officeId} = context.params;

  const [beneficiaryId, officeDoc] = await Promise.all([
    getBeneficiaryId({
      phoneNumber,
      /**
       * There will be docs where roleDoc is `null`/`undefined`
       */
      roleDoc,
      /**
       * Some old docs might not have `officeId`.
       * Don't wanna take the risk of crashes.
       */
      officeId,
    }),
    rootCollections.offices.doc(officeId).get(),
  ]);

  console.log('officeDoc', officeDoc);
  console.log('beneficiaryId', beneficiaryId);

  // This case should currently never happen because
  // user will have at least one role.
  if (!beneficiaryId) {
    return;
  }

  const reimbursementFrequency =
    officeDoc.get('attachment.Reimbursement Frequency.value') ||
    reimbursementsFrequencies.MONTHLY;

  const cycleDates = getCycleDates({
    reimbursementFrequency,
    date,
    month,
    year,
  });

  const {
    docs: [firstVoucherDoc],
  } = await rootCollections.offices
    .doc(officeId)
    .collection(subcollectionNames.VOUCHERS)
    .where('cycle', '==', cycleDates)
    .where('beneficiaryId', '==', beneficiaryId)
    .where('type', '==', addendumTypes.REIMBURSEMENT)
    .where('batchId', '==', null)
    .get();
  const ref = firstVoucherDoc
    ? firstVoucherDoc.ref
    : rootCollections.offices
        .doc(officeId)
        .collection(subcollectionNames.VOUCHERS)
        .doc();
  const data = firstVoucherDoc
    ? firstVoucherDoc.data()
    : getDefaultVoucher({
        date,
        month,
        year,
        office,
        officeId,
        beneficiaryId,
        amount: 0,
        cycle: cycleDates,
      });

  console.log('ref', ref.path);
  console.log('data', data);
  batch.set(ref, data, {merge: true});

  // return batch.commit();

  return;
};

module.exports = async (change, context) => {
  try {
    return reimbursementHandler(change, context);
  } catch (error) {
    console.error(error);
  }
};
