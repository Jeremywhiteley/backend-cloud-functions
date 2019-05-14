console.log('home loaded');

const section = document.getElementById('action-section');


function excelUploadContainer(id) {
  const container = document.createElement('div')

  const uploadContainer = document.createElement('div')
  uploadContainer.className = 'upload-container'
  const input = document.createElement('input')
  input.type = 'file';
  input.id = id;
  input.accept = '.xlsx, .xls , .csv'
  const label = document.createElement('label')
  label.textContent = 'Upload File';
  uploadContainer.appendChild(label);
  uploadContainer.appendChild(input);
  const p = document.createElement('p')
  p.className = 'notification-label';
  uploadContainer.appendChild(p);
  const result = document.createElement('div')
  result.id = 'upload-result-error';
  uploadContainer.appendChild(result)

  const downloadContainer = document.createElement('div');
  downloadContainer.className = 'download-container mt-30';
  const button = document.createElement('button')
  button.className = 'button'
  button.textContent = 'Download Sample';
  downloadContainer.appendChild(button)
  container.appendChild(uploadContainer);
  container.appendChild(downloadContainer);

  return container;

}

function BulkCreateErrorContainer(originalData, rejectedOnes) {
  const cont = document.getElementById('upload-result-error')
  cont.innerHTML = '';
  const frag = document.createDocumentFragment();
  if (rejectedOnes.length >= 2) {
    cont.style.height = '200px';
  }
  rejectedOnes.forEach(function (value, idx) {
    const span = document.createElement('span')
    span.textContent = 'Error at row number : ' + originalData[idx].__rowNum__
    const p = document.createElement('p')
    p.textContent = value.reason
    p.className = 'warning-label'
    frag.appendChild(span)
    frag.appendChild(p)
  })
  cont.appendChild(frag);
}

function createEmployeesAsSupport(office, template) {
  /**
   * Create a file upload button
   */

  const url = apiBaseUrl + '/admin/bulk?support=true'

  const modal = createModal(excelUploadContainer('upload-employee'))
  const upload = modal.querySelector('#upload-employee')
  const notificationLabel = modal.querySelector('.notification-label')
  upload.addEventListener('change', function (evt) {
    evt.stopPropagation();
    evt.preventDefault();

    const files = evt.target.files;
    const file = files[0];
    const reader = new FileReader();

    reader.onload = function (e) {
      const data = e.target.result;

      e.target.ressul
      const wb = XLSX.read(data, {
        type: 'binary'
      });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(ws, {
        blankRows: false,
        defval: '',
        raw: false
      });
      if (!jsonData.length) {
        notificationLabel.className = 'notification-label warning-label'
        notificationLabel.textContent = 'File is Empty'
        return;
      };
      jsonData.forEach(function (val) {
        val.share = [];
      })

      getLocation().then(function (location) {

        const body = {
          office: office,
          template: template,
          data: jsonData,
          timestamp: Date.now(),
          geopoint: location
        }

        return sendApiRequest(`${url}`, body, 'POST')
          .then(function (response) {
            return response.json();
          })
          .then(function (response) {
            const rejectedOnes = response.data.filter((val) => val.rejected);
            if (!rejectedOnes.length) {
              notificationLabel.className = 'notification-label success-label'
              notificationLabel.textContent = 'Success';
              return;
            }
            notificationLabel.textContent = '';
            BulkCreateErrorContainer(jsonData, rejectedOnes)
          }).catch(console.error);
      }).catch(function (error) {
        notificationLabel.className = 'notification-label warning-label'
        notificationLabel.textContent = error.message;
      })

    }
    reader.readAsBinaryString(file);
    console.log(evt);
  });
  document.getElementById('modal-box').appendChild(modal);

};

function addEmployeeWithSupport(options) {
  const requestUrl = `${apiBaseUrl}/admin/search?support=true`;
  const searchForm = document.createElement('form');
  const searchInput = document.createElement('input');
  const searchLink = document.createElement('a');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search an office';
  searchInput.classList.add('input-field');
  searchForm.style.display = 'inherit';

  searchLink.classList.add('button');
  searchLink.innerText = 'search';
  searchForm.appendChild(searchInput);
  searchForm.appendChild(searchLink);
  section.appendChild(searchForm);

  searchLink.onclick = function () {
    console.log('button clicked');

    /** Hide all previously warning labels */
    document
      .querySelectorAll('.warning-label')
      .forEach(function (elem) {
        elem.style.display = 'none'
      });

    const searchedTerm = searchInput.value;

    if (!isNonEmptyString(searchedTerm)) {
      const node = document.createElement('p');
      node.classList.add('warning-label');
      node.innerText = 'Invalid input';

      return void insertAfterNode(searchForm, node);
    }

    console.log('searched for:', searchedTerm);
    console.log('url', `${requestUrl}&office=${searchedTerm}`);

    return sendApiRequest(`${requestUrl}&office=${searchedTerm}`, null, 'GET')
      .then(function (response) {
        return response.json();
      })
      .then(function (response) {

        console.log('response', response);
        const select = document.createElement('select');
        searchForm.style.display = 'none';
        if (!response.length) {
          const p = document.createElement('p');
          p.innerText = 'No offices found';
          section.appendChild(p);
          return;
        }
        const a = document.createElement('a');
        a.classList.add('button');
        a.href = '#';
        a.textContent = 'submit';
        a.onclick = function (event) {
          const office = select.options[select.selectedIndex].value
          createEmployeesAsSupport(office, 'employee');
        }

        section.appendChild(select);
        section.appendChild(a);

        response.forEach((name) => {
          const option = document.createElement('option');
          option.value = name;
          option.innerHTML = name;
          select.appendChild(option);
        });

      })
      .catch(console.error);
  }
}

function addEmployeeWithAdmin() {

}

function triggerReportWithSupport() {

}

function triggerReportWithAdmin() {

}

function updatePhoneNumberWithSupport() {

}

function updatePhoneNumberWithAdmin() {

}

function employeExitWithSupport() {

}

function employeExitWithAdmin() {

}

function updateReportRecipientsWithSupport() {

}

function updateReportRecipientsWithAdmin() {

}

function updateSubscriptionWithAdmin() {

}

function updateSubscriptionWithSupport() {

}

function searchAndUpdateWithAdmin() {

}

function searchAndUpdateWithSupport() {

}

function viewEnquiries() {

}

/**
 * Only `support` and `manageTemplates` claim allow messing with the templates.
 */
function manageTemplates() {

}

function addEmployees(options) {

}

function triggerReport(options) {

}

function changePhoneNumber(options) {

}

function employeeResign(options) {

}

function updateRecipient(options) {

}

function updateSubscription(options) {

}

function updateActivity(options) {

}

function viewEnquiries(options) {

}

function manageTemplates(options) {

};

function handleActionIconClick(event) {
  event.preventDefault();
  // Delete all elements for a clean slate
  while (section.firstChild) {
    section.removeChild(section.firstChild);
  }

  console.log('clicked', event.target.id);

  const options = {
    isSupport: false,
    isAdmin: false,
    isTemplateManager: false,
    officeNames: [],
  };

  return firebase
    .auth()
    .currentUser
    .getIdTokenResult()
    .then(function (getIdTokenResult) {
      const claims = getIdTokenResult.claims;

      if (event.target.id === 'add-employees') {
        if (options.isAdmin) {
          return void addEmployeeWithAdmin(options);
        }

        return void addEmployeeWithSupport(options);
      }

      if (event.target.id === 'trigger-reports') {
        if (options.isAdmin) {
          return void triggerReportWithAdmin(options);
        }

        return void triggerReportWithSupport();
      }

      if (event.target.id === 'change-phone-number') {
        if (options.isAdmin) {
          return void updatePhoneNumberWithAdmin(options);
        }

        return updatePhoneNumberWithSupport(options);
      }

      if (event.target.id === 'employee-resign') {
        if (options.isAdmin) {
          return employeExitWithAdmin(options);
        }

        return employeExitWithSupport(options);
      }

      if (event.target.id === 'update-subscription') {
        if (options.isAdmin) {
          return updateSubscriptionWithAdmin(options);
        }

        return updateSubscriptionWithSupport(option);
      }

      if (event.target.id === 'update-activity') {
        if (options.isAdmin) {
          return updateSubscriptionWithSupport(options);
        }

        return updateSubscriptionWithSupport(options);
      }

      if (event.target.id === 'view-enquiries') {
        return viewEnquiries(options);
      }

      if (event.target.id === 'manage-templates') {
        return void manageTemplates(options);
      }
    })
    .catch(console.error);
};