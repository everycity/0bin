/*global sjcl:true, jQuery:true, lzw:true, zerobin:true, prettyPrint:true */

/*
  This file has been migrated away from jQuery, to Vue. Because of the way
  the code base used to be, a lot of the operations are still using imperative
   DOM manipulation instead of the Vue declarative style. We haven't had the
   time to rewrite it completly and it's a bit of a mixed bag at the moment.
*/

/* Start random number generator seeding ASAP */
sjcl.random.startCollectors();

// Vue template syntax conflicts with bottle template syntax
Vue.options.delimiters = ['{%', '%}'];

// Force focus for textarea (firefox hack)
setTimeout(function () {
  document.querySelector('textarea').focus()
}, 100)

// Parse obfuscaded emails and make them usable
const menu = new Vue({
  el: "#menu-top",
  methods: {
    formatEmail: (email) => {
      return "mailto:" + email.replace('__AT__', '@');
    },
  }
})

const app = new Vue({

  el: '#wrap-content',
  data: {
    previousPastes: [],
    downloadLink: {},
    displayBottomToolBar: false,
    isUploading: false,
    currentPaste: {
      ownerKey: '',
      id: ''
    },
    newPaste: {
      expiration: '1_day',
      content: '',
    },
    messages: [],
    /** Check for browser support of the named featured. Store the result
    and add a class to the html tag with the result */
    support: {

      clipboard: (function () {
        var val = !!(navigator.clipboard);
        document.querySelector('html').classList.add((val ? '' : 'no-') + 'clipboard');
        return val;
      })(),

      localStorage: (function () {
        var val = !!(localStorage);
        document.querySelector('html').classList.add((val ? '' : 'no-') + 'local-storage');
        return val;
      })(),

      history: (function () {
        var val = !!(window.history && history.pushState);
        document.querySelector('html').classList.add((val ? '' : 'no-') + 'history');
        return val;
      })(),

      fileUpload: (function () {
        var w = window;
        var val = !!(w.File && w.FileReader && w.FileList && w.Blob);
        document.querySelector('html').classList.add((val ? '' : 'no-') + 'file-upload');
        return val;
      })()
    },
    isLoading: false
  },
  methods: {
    forceLoadPaste: (link) => {
      window.location = link;
      window.location.reload();
    },

    handleClone: () => {

      document.querySelector('.submit-form').style.display = "inherit";
      document.querySelector('.paste-form').style.display = "none";
      let content = document.getElementById('content');
      content.value = zerobin.getPasteContent();
      content.dispatchEvent(new Event('change'));
    },

    handleCancelClone: () => {
      document.querySelector('.submit-form').style.display = "none";
      document.querySelector('.paste-form').style.display = "inherit";
    },

    handleUpload: (files) => {
      try {
        app.isUploading = true;
        zerobin.upload(files);
      } catch (e) {
        zerobin.message('error', 'Could no upload the file', 'Error');
      }
      app.isUploading = false;
    },

    handleForceColoration: (e) => {
      let content = document.getElementById('paste-content');
      content.classList.add('linenums');
      e.target.innerHTML = 'Applying coloration';
      prettyPrint();
      e.target.parentNode.remove()
    },

    handleSendByEmail: (e) => {
      e.target.href = 'mailto:friend@example.com?body=' + window.location.toString();
    },

    handleDeletePaste: () => {
      if (window.confirm("Delete this paste?")) {
        app.isLoading = true;
        bar.set('Deleting paste...', '50%');

        fetch('/paste/' + app.currentPaste.id, {
          method: "DELETE",
          body: new URLSearchParams({
            "owner_key": app.currentPaste.ownerKey
          })
        }).then(function (response) {
          if (response.ok) {
            window.location = "/";
            window.reload()
          } else {
            form.forEach((node) => node.disabled = false);
            app.isLoading = false
            zerobin.message(
              'error',
              'Paste could not be deleted. Please try again later.',
              'Error');
          }
          app.isLoading = false;
        }).catch(function (error) {
          zerobin.message(
            'error',
            'Paste could not be delete. Please try again later.',
            'Error');
          app.isLoading = false;
        });
      }
    },

    copyToClipboard: () => {

      var pasteContent = zerobin.getPasteContent();
      let promise;

      if (pasteContent.indexOf("data:image") === 0) {

        promise = fetch(pasteContent).then((res) => {
          return res.blob().then(blob => {
            return navigator.clipboard.write([
              new ClipboardItem({
                [blob.type]: blob
              })
            ])
          })
        })

      } else {
        promise = navigator.clipboard.writeText(pasteContent);
      }

      promise.then(function () {
        zerobin.message('info', 'The paste is now in your clipboard', '', true);
      }, function (err) {
        zerobin.message('error', 'The paste could not be copied', '', true);
      });

    },

    /**
      On the create paste page:
      On click on the send button, compress and encrypt data before
      posting it using ajax. Then redirect to the address of the
      newly created paste, adding the key in the hash.
    */

    encryptAndSendPaste: (e) => {

      var paste = document.querySelector('textarea').value;

      if (paste.trim()) {

        var form = document.querySelectorAll('input, textarea, select, button');

        form.forEach((node) => node.disabled = true);

        // set up progress bar
        var bar = zerobin.progressBar('form.well .progress');
        app.isLoading = true;
        bar.set('Converting paste to bits...', '25%');

        /* Encode, compress, encrypt and send the paste then redirect the user
          to the new paste. We ensure a loading animation is updated
          during the process by passing callbacks.
        */
        try {

          var key = zerobin.makeKey(256);

          zerobin.encrypt(key, paste,

            () => bar.set('Encoding to base64...', '45%'),
            () => bar.set('Compressing...', '65%'),
            () => bar.set('Encrypting...', '85%'),

            /* This block deals with sending the data, redirection or error handling */
            function (content) {

              bar.set('Sending...', '95%');
              var data = {
                content: content,
                expiration: app.newPaste.expiration
              };
              var sizebytes = zerobin.count(JSON.stringify(data));
              var oversized = sizebytes > zerobin.max_size; // 100kb - the others header information
              var readableFsize = Math.round(sizebytes / 1024);
              var readableMaxsize = Math.round(zerobin.max_size / 1024);

              if (oversized) {
                app.isLoading = false
                form.forEach((node) => node.disabled = false);
                zerobin.message('error', ('The encrypted file was <strong class="file-size">' + readableFsize +
                    '</strong>KB. You have reached the maximum size limit of ' + readableMaxsize + 'KB.'),
                  'Warning!', true);
                return;
              }

              fetch('/paste/create', {
                method: "POST",
                body: new URLSearchParams(data)
              }).then(function (response) {
                if (response.ok) {
                  bar.set('Redirecting to new paste...', '100%');

                  response.json().then((data) => {
                    if (data.status === 'error') {
                      zerobin.message('error', data.message, 'Error');
                      form.forEach((node) => node.disabled = false);
                      app.isLoading = false
                    } else {
                      if (app.support.localStorage) {
                        zerobin.storePaste('/paste/' + data.paste + "?owner_key=" + data.owner_key + '#' + key);
                      }
                      window.location = ('/paste/' + data.paste + '#' + key);
                    }
                  })

                } else {
                  form.forEach((node) => node.disabled = false);
                  app.isLoading = false
                  zerobin.message(
                    'error',
                    'Paste could not be saved. Please try again later.',
                    'Error');
                }
              }).catch(function (error) {
                form.forEach((node) => node.disabled = false);
                app.isLoading = false
                zerobin.message(
                  'error',
                  'Paste could not be saved. Please try again later.',
                  'Error');
              });

            });
        } catch (err) {
          form.forEach((node) => node.disabled = false);
          app.isLoading = false
          zerobin.message('error', 'Paste could not be encrypted. Aborting.',
            'Error');
        }
      }
    }
  }
})

/****************************
 ****  0bin utilities    ****
 ****************************/

window.zerobin = {
  /** Base64 + compress + encrypt, with callbacks before each operation,
      and all of them are executed in a timed continuation to give
      a change to the UI to respond.
  */
  version: '0.1.1',
  encrypt: function (key, content, toBase64Callback,
    compressCallback, encryptCallback, doneCallback) {

    setTimeout(function () {

      content = sjcl.codec.utf8String.toBits(content);
      if (toBase64Callback) {
        toBase64Callback();
      }

      setTimeout(function () {

        content = sjcl.codec.base64.fromBits(content);
        if (compressCallback) {
          compressCallback();
        }

        setTimeout(function () {

          // content = lzw.compress(content); // Create a bug with JPG
          if (encryptCallback) {
            encryptCallback();
          }

          setTimeout(function () {
            try {
              content = sjcl.encrypt(key, content);
            } catch (e) {

              document.querySelectorAll('input, textarea, select, button').forEach((node) => node.disabled = true);

              app.isLoading = false;

              zerobin.message('error', 'Paste could not be encrypted. Aborting.',
                'Error');
            }
            if (doneCallback) {
              doneCallback(content);
            }
          }, 250);

        }, 250);

      }, 250);

    }, 250);
  },

  /** Base64 decoding + uncompress + decrypt, with callbacks before each operation,
    and all of them are executed in a timed continuation to give
    a change to the UI to respond.

    This is where using a library to fake synchronicity could start to be
    useful, this code is starting be difficult to read. If anyone read this
    and got a suggestion, by all means, speak your mind.
  */
  decrypt: function (key, content, errorCallback, uncompressCallback,
    fromBase64Callback, toStringCallback, doneCallback) {

    /* Decrypt */
    setTimeout(function () {
      try {
        content = sjcl.decrypt(key, content);
        if (uncompressCallback) {
          uncompressCallback();
        }

        /* Decompress */
        setTimeout(function () {
          try {
            content = lzw.decompress(content);
            if (fromBase64Callback) {
              fromBase64Callback();
            }

            /* From base 64 to bits */
            setTimeout(function () {
              try {
                content = sjcl.codec.base64.toBits(content);
                if (toStringCallback) {
                  toStringCallback();
                }

                /* From bits to string */
                setTimeout(function () {
                  try {
                    content = sjcl.codec.utf8String.fromBits(content);
                    if (doneCallback) {
                      doneCallback(content);
                    }
                  } catch (err) {
                    errorCallback(err);
                  }

                }, 250); /* "End of from bits to string" */

              } catch (err) {
                errorCallback(err);
              }

            }, 250); /* End of "from base 64 to bits" */

          } catch (err) {
            errorCallback(err);
          }

        }, 250); /* End of "decompress" */

      } catch (err) {
        errorCallback(err);
      }

    }, 250); /* End of "decrypt" */
  },

  /** Create a random base64-like string long enought to be suitable as
      an encryption key */
  makeKey: function (entropy) {
    entropy = Math.ceil(entropy / 6) * 6; /* non-6-multiple produces same-length base64 */
    var key = sjcl.bitArray.clamp(
      sjcl.random.randomWords(Math.ceil(entropy / 32), 0), entropy);
    return sjcl.codec.base64.fromBits(key, 0).replace(/\=+$/, '').replace(/\//, '-');
  },

  getFormatedDate: function (date) {
    date = date || new Date();
    return ((date.getMonth() + 1) + '-' + date.getDate() + '-' + date.getFullYear());
  },

  getFormatedTime: function (date) {
    date = date || new Date();
    var h = date.getHours(),
      m = date.getMinutes(),
      s = date.getSeconds();
    if (h < 10) {
      h = "0" + h;
    }
    if (m < 10) {
      m = "0" + m;
    }
    if (s < 10) {
      s = "0" + s;
    }
    return h + ":" + m + ":" + s;
  },

  numOrdA: function (a, b) {
    return (a - b);
  },

  /** Return a reverse sorted list of all the keys in local storage that
    are prefixed with with the passed version (default being this lib
    version) */
  getLocalStorageURLKeys: function () {
    var version = 'zerobinV' + zerobin.version;
    var keys = [];
    for (var key in localStorage) {
      if (key.indexOf(version) !== -1 && key.indexOf("owner_key") === -1) {
        keys.push(key);
      }
    }
    keys.sort();
    keys.reverse();
    return keys;
  },

  /** Store the paste of a URL in local storate, with a storage format
    version prefix and the paste date as the key */
  storePaste: function (url, date) {

    date = date || new Date();
    date = (date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate() + ' ' + zerobin.getFormatedTime(date));

    var keys = zerobin.getLocalStorageURLKeys();

    if (localStorage.length > 19) {
      void localStorage.removeItem(keys[19]);
    }

    localStorage.setItem('zerobinV' + zerobin.version + "#" + date, url);
    localStorage.setItem('zerobinV' + zerobin.version + "#" + zerobin.getPasteId(url) + "#owner_key", zerobin.getPasteOwnerKey(url));
  },

  /** Return a list of the previous paste url with the creation date
      If the paste is from today, date format should be "at hh:ss",
      else it should be "the mm-dd-yyy"
  */
  getPreviousPastes: function () {
    var keys = zerobin.getLocalStorageURLKeys(),
      today = zerobin.getFormatedDate();

    return keys.map(function (key, i) {
      var pasteDateTime = key.replace(/^[^#]+#/, '');
      var displayDate = pasteDateTime.match(/^(\d+)-(\d+)-(\d+)\s/);
      displayDate = displayDate[2] + '-' + displayDate[3] + '-' + displayDate[1];
      var prefix = 'the ';
      if (displayDate === today) {
        displayDate = pasteDateTime.split(' ')[1];
        prefix = 'at ';
      }
      let link = localStorage.getItem(key);

      return {
        displayDate: displayDate,
        prefix: prefix,
        // The owner key is stored in the URL, but we don't want the user
        // to see it
        link: link.replace(/\?[^#]+#/, '#'),
        isCurrent: link.replace(/\?[^?]+/, '') === window.location.pathname
      };
    });

  },

  /** Return a link object with the URL as href so you can extract host,
    protocol, hash, etc.

    This function use a closure to store a <div> parent for the <a>
    because IE requires the link be processed by it's HTML parser
    for the URL to be parsed. */
  parseUrl: (function () {

    var div = document.createElement('div');
    div.innerHTML = "<a></a>";

    return function (url) {
      div.firstChild.href = url;
      div.innerHTML = div.innerHTML;
      return div.firstChild;
    };

  })(),

  getPasteId: function (url) {
    var loc = url ? zerobin.parseUrl(url) : window.location;
    return loc.pathname.replace(/\/|paste/g, '');
  },

  getPasteOwnerKey: function (url) {
    var loc = url ? zerobin.parseUrl(url) : window.location;
    return (new URLSearchParams(loc.search)).get("owner_key");
  },

  getPasteKey: function (url) {
    var loc = url ? zerobin.parseUrl(url) : window.location;
    return loc.hash.replace('#', '').replace(/(\?|&).*$/, '');
  },

  /** Return the paste content stripted from any code coloration */
  getPasteContent: function () {
    var copy = '';
    document.querySelectorAll("#paste-content li").forEach((node) => {
      copy = copy + node.textContent.replace(/[\u00a0]+/g, ' ') + '\n';

    })
    if (copy === '') {
      copy = document.querySelector("#paste-content").textContent;
    }
    return copy;
  },

  /** Return an approximate estimate of the number of bytes in a text */
  count: function (text, options) {
    // Set option defaults
    var crlf = /(\r?\n|\r)/g;
    var whitespace = /(\r?\n|\r|\s+)/g;
    options = options || {};
    options.lineBreaks = options.lineBreaks || 1;

    var length = text.length,
      nonAscii = length - text.replace(/[\u0100-\uFFFF]/g, '').length,
      lineBreaks = length - text.replace(crlf, '').length;

    return length + nonAscii + Math.max(0, options.lineBreaks * (lineBreaks - 1));
  },
  /** Create a message, style it and insert it in the alert box */
  message: function (type, message, title, flush, callback, action) {
    window.scrollTo(0, 0);
    if (flush) {
      app.messages = app.messages.filter((msg) => {
        msg.type !== type
      });
    }
    app.messages.push({
      title: title,
      content: message,
      type: type,
      action: action || {},
    });
    callback && callback()
  },

  /** Return a progress bar object */
  progressBar: function (selector) {
    var container = document.querySelector(selector);
    var bar = {
      container: container,
      elem: container.childNodes[0]
    };
    bar.set = function (text, rate) {
      bar.elem.innerHTML = text;
      bar.elem.style.width = rate;
    };
    return bar;
  },

  /** Return an integer ranking the probability this text is any kind of
    source code. */
  isCode: function (text) {

    var code_chars = /[A-Z]{3}[A-Z]+|\.[a-z]|[=:<>{}\[\]$_'"&]| {2}|\t/g;
    var comments = /(:?\/\*|<!--)(:?.|\n)*?(:?\*\/|-->)|(\/\/|#)(.*?)\n/g;
    var formating = /[-*=_+]{4,}/;

    var total = 0;
    var size = 0;
    var m = text.match(comments);
    if (m) {
      total += text.match(comments).length;
    }
    text = text.replace(comments, '');
    text.replace(formating, '');
    text = text.split('\n');
    for (var i = 0; i < text.length; i++) {
      var line = text[i];
      size += line.length;
      var match = line.replace(formating, '').match(code_chars);
      if (match) {
        total += match.length;
      }
    }

    return total * 250 / size;
  },

  // prevent defaults
  ignoreDrag: function (e) {
    e.stopPropagation();
    e.preventDefault();
  },

  // Handle Drop
  handleDrop: function (e) {
    e.preventDefault();
    zerobin.upload(e.dataTransfer.files);
    document.getElementById("content").classList.remove("hover");
  },

  handleDragOver: function (e) {
    zerobin.ignoreDrag(e);
    document.getElementById("content").classList.add('hover');
  },

  handleDragLeave: function (e) {
    document.getElementById("content").classList.remove("hover");
  },

  upload: function (files) {
    let content = document.getElementById('content');
    var current_file = files[0];
    var reader = new FileReader();
    if (current_file.type.indexOf('image') == 0) {
      reader.onload = function (event) {
        var image = new Image();
        image.src = event.target.result;

        image.onload = function () {
          var maxWidth = 1024,
            maxHeight = 1024,
            imageWidth = image.width,
            imageHeight = image.height;

          if (imageWidth > imageHeight) {
            if (imageWidth > maxWidth) {
              imageHeight *= maxWidth / imageWidth;
              imageWidth = maxWidth;
            }
          } else {
            if (imageHeight > maxHeight) {
              imageWidth *= maxHeight / imageHeight;
              imageHeight = maxHeight;
            }
          }

          var canvas = document.createElement('canvas');
          canvas.width = imageWidth;
          canvas.height = imageHeight;
          image.width = imageWidth;
          image.height = imageHeight;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(this, 0, 0, imageWidth, imageHeight);

          var paste = canvas.toDataURL(current_file.type);

          content.value = paste;
          content.dispatchEvent(new Event('change'));

          image.style.maxWidth = '742px';

          content.style.display = "none";
          content.after(image);

        }
      }
      reader.readAsDataURL(current_file);
    } else {
      reader.onload = function (event) {
        content.value = event.target.result
        content.dispatchEvent(new Event('change'));
      };
      reader.readAsText(current_file);
    }
  }
};

/**
    DECRYPTION:
    On the display paste page, decrypt and decompress the paste content,
    add syntax coloration then setup the copy to clipboard button.
    Also calculate and set the paste visual hash.
*/

let pasteContent = document.querySelector('#paste-content');
let content = '';

if (pasteContent) {
  content = pasteContent.textContent.trim();
  app.currentPaste.id = zerobin.getPasteId(window.location);
}

var key = zerobin.getPasteKey();
var error = false;

if (content && key) {

  var form = document.querySelectorAll('input, textarea, select, button');
  form.forEach((node) => node.disabled = true);

  var bar = zerobin.progressBar('.well form .progress');
  app.isLoading = true;
  bar.set('Decrypting paste...', '25%');

  zerobin.decrypt(key, content,

    /* On error*/
    function () {
      app.isLoading = false;
      zerobin.message('error', 'Could not decrypt data (Wrong key ?)', 'Error');
    },

    /* Update progress bar */
    () => bar.set('Decompressing...', '45%'),
    () => bar.set('Base64 decoding...', '65%'),
    () => bar.set('From bits to string...', '85%'),

    /* When done */
    function (content) {

      /* Decrypted content goes back to initial container*/
      document.querySelector('#paste-content').innerHTML = content;

      if (content.indexOf('data:image') == 0) {
        // Display Image

        let pasteContent = document.querySelector('#paste-content');
        pasteContent.style.display = "none";

        var img = document.createElement('img')
        img.src = content;
        img.style.maxWidth = '742px';

        pasteContent.after(img);

        // Display Download button
        document.querySelectorAll('.btn-clone').forEach((node) => node.style.display = "none")

        app.downloadLink = {
          name: '0bin_' + document.location.pathname.split('/').pop(),
          url: content
        }

      }
      bar.set('Code coloration...', '95%');

      /* Add a continuation to let the UI redraw */
      setTimeout(function () {

        /** Syntaxic coloration */

        if (zerobin.isCode(content) > 100) {
          document.getElementById('paste-content').classList.add('linenums');
          prettyPrint();
        } else {
          if (content.indexOf('data:image') != 0) {
            zerobin.message('dismissible',
              "The paste did not seem to be code, so it " +
              "was not colorized. ",
              '', false, undefined, {
                message: "Force coloration",
                callback: app.handleForceColoration
              });
          }
        }

        /* Class to switch to paste content style with coloration done */
        document.getElementById('paste-content').classList.add('done');

        /* Display result */
        bar.set('Done', '100%');
        app.isLoading = false;

        form.forEach((node) => node.disabled = false);
        content = '';

      }, 100);

    });

} /* End of "DECRYPTION" */

/* Display bottom paste option buttons when needed */

window.onload = function () {
  ["keyup", "change"].forEach((event) => {
    let content = document.getElementById("content");
    content.addEventListener(event, () => {
      let height = parseFloat(getComputedStyle(content, null).height.replace("px", ""))
      app.displayBottomToolBar = height > 400;
    })
  })
}

/* Display previous pastes */
if (app.support.localStorage) {
  app.previousPastes = zerobin.getPreviousPastes();
  app.currentPaste.ownerKey = localStorage.getItem('zerobinV' + zerobin.version + "#" + zerobin.getPasteId(window.location) + "#owner_key");
}

/* Upload file using HTML5 File API */
if (app.support.fileUpload) {

  // Implements drag & drop upload
  let content = document.getElementById('content');
  content.addEventListener('drop', zerobin.handleDrop);
  content.addEventListener('dragover', zerobin.handleDragOver);
  content.addEventListener('dragleave', zerobin.handleDragLeave);

}

/* Remove expired pasted from history */
if (app.support.history && zerobin.paste_not_found) {
  var paste_id = zerobin.getPasteId();
  var keys = zerobin.getLocalStorageURLKeys();
  keys.forEach((key, i) => {
    if (localStorage[key].indexOf(paste_id) !== -1) {
      localStorage.removeItem(key);
      return false;
    }
  })
}
