'use strict';


const {
  rootCollections,
} = require('../../admin/admin');

const {
  sendGridTemplateIds,
} = require('../../admin/constants');

const {
  getYesterdaysDateString,
} = require('./report-utils');

const xlsxPopulate = require('xlsx-populate');
const fs = require('fs');


module.exports = (locals) => {
  const {
    office,
    officeId,
  } = locals.change.after.data();

  locals.yesterdaysDate = getYesterdaysDateString();
  locals.messageObject.templateId = sendGridTemplateIds.footprints;
  locals.csvString =
    ` Dated,`
    + ` Department,`
    + ` Base Location,`
    + ` Name,`
    + ` Time,`
    + ` Distance Travelled,`
    + ` Address,`
    + `\n`;

  locals.messageObject['dynamic_template_data'] = {
    office,
    subject: `${office} Footprints Report_${locals.yesterdaysDate}`,
    date: locals.yesterdaysDate,
  };

  locals.fileName = `${office} Footprints Report_${locals.yesterdaysDate}.xlsx`;
  locals.filePath = `/tmp/${locals.fileName}`;
  console.log('locals.filePath:', locals.filePath);

  const officeDocRef = rootCollections
    .offices
    .doc(officeId);

  console.log({ officeDocRef: officeDocRef.path, });

  return Promise
    .all([
      officeDocRef
        .get(),
      officeDocRef
        .collection('Addendum')
        .where('date', '==', locals.yesterdaysDate)
        .orderBy('user')
        .orderBy('timestamp', 'asc')
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [
        officeDoc,
        addendumDocs,
        workbook,
      ] = result;

      locals.toSendMails = true;
      console.log('addendumDocs.empty', addendumDocs.empty);

      if (addendumDocs.empty) {
        console.log('No docs found in Addendum');

        locals.toSendMails = false;

        return Promise.resolve(false);
      }

      [
        'Dated',
        'Department',
        'Base Location',
        'Name',
        'Time',
        'Distance Travelled',
        'Address',
      ].forEach((header, index) => {
        const rowChars = ['A', 'B', 'C', 'D', 'E', 'F, G',];
        workbook
          .sheet('Sheet1')
          .cell(`${rowChars[index]}1`)
          .value(header);
      });

      const employeesData = officeDoc.get('employeesData');

      addendumDocs.docs.forEach((doc, index) => {
        const phoneNumber = doc.get('user');
        const department = employeesData[phoneNumber].Department;
        const name = employeesData[phoneNumber].Name;
        const baseLocation = employeesData[phoneNumber]['Base Location'];
        const url = doc.get('url');
        const identifier = doc.get('identifier');
        let accumulatedDistance = doc.get('accumulatedDistance');

        if (typeof doc.get('accumulatedDistance') === 'number') {
          accumulatedDistance = accumulatedDistance.toFixed(2);
        }

        // TODO: Add spacing for columns based on max width of the fields
        workbook
          .sheet('Sheet1')
          .cell(`A${index + 2}`)
          .value(locals.yesterdaysDate);
        workbook
          .sheet('Sheet1')
          .cell(`B${index + 2}`)
          .value(department);
        workbook
          .sheet('Sheet1')
          .cell(`C${index + 2}`)
          .value(baseLocation);
        workbook
          .sheet('Sheet1')
          .cell(`D${index + 2}`)
          .value(name);
        workbook
          .sheet('Sheet1')
          .cell(`E${index + 2}`)
          .value(doc.get('timeString'));
        workbook
          .sheet('Sheet1')
          .cell(`F${index + 2}`)
          .value(accumulatedDistance);
        // TODO: Set text styling for URLs underline + italic
        workbook
          .sheet('Sheet1')
          .cell(`G${index + 2}`)
          .value(identifier)
          .hyperlink(url);
      });

      return workbook.toFileAsync(locals.filePath);
    })
    .then(() => {
      if (!locals.toSendMails) {
        console.log('inside then. Not sending mails.');

        return Promise.resolve();
      }

      locals.messageObject.attachments.push({
        content: new Buffer(fs.readFileSync(locals.filePath)).toString('base64'),
        fileName: `${office} Footprints Report_${locals.yesterdaysDate}.xlsx`,
        type: 'text/csv',
        disposition: 'attachment',
      });

      console.log('locals.messageObject', locals.messageObject);

      return locals.sgMail.sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
