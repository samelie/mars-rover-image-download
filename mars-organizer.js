var r = require('request');
var _ = require('lodash');
var rimraf = require('rimraf');
var fs = require('fs-extra');
var path = require('path');
var readDir = require('readdir');
var yargs = require('yargs').argv;
var Prom = require('bluebird');
var ex = require('child_process').exec;
var Exec = Prom.promisify(require('child_process').exec);
var move = Prom.promisify(fs.move);

fs.chmodSync('./compare', '755');

'use strict';
//ffmpeg -framerate 18  -pattern_type glob -i "*.jpg" -c:v libx264 -r 30 -pix_fmt yuv420p -y -vf scale=256:256 video.mp4
//http://mwholt.blogspot.co.uk/2014/08/convert-video-to-animated-gif-with.html

//ffmpeg -i input.mp4 -r 20 -f image2pipe -vcodec ppm - | convert -delay 5 - gif:- | convert -layers Optimize - output.gif

//Fgjfq0IkgQ30ElOQnztTuMvmOl2P6D4skJw7tD4m
//Ru46bKZ7yl29jqKB7C9WYd8W91NEeay5TEsrlRAl

//**************************
//convert MAST_2015-02-08_89873.jpg[1x1+10+10] -format "%[fx:int(255*r)],%[fx:int(255*g)],%[fx:int(255*b)]" info:
//**************************
//compare -verbose -metric MAE CHEMCAM_2014-12-30_51935.jpg  CHEMCAM_2014-12-30_51947.jpg  null: 2>&1
//**************************

var CHEMDIR = path.join(__dirname, 'chemcam');
var CHEM_THRESH = 0.06;
var previousImage;

function chemcam() {
  fs.mkdirSync(CHEMDIR);
  var files = readDir.readSync(path.join(__dirname, 'chemtest'), ['**.jpg'], readDir.ABSOLUTE_PATHS);
  var chemcamFiles = [];
  var wc = 0;
  _.each(files, function(p) {
    if (p.indexOf('CHEMCAM') !== -1) {
      chemcamFiles.push(p);
    }
  });
  _.each(chemcamFiles, function(p) {
    var name = p.split('/');
    name = name[name.length - 1];
    var out = fs.createWriteStream(path.join(CHEMDIR, name));
    out.on('finish', function() {
      wc++;
      if (wc === chemcamFiles.length) {
        console.log(chemcamFiles.length);
        compare(chemcamFiles);
      }
    });
    fs.createReadStream(p).pipe(out);
  });
  //console.log(chemcamFiles);
}


function compare(files) {
  var groups = 0;
  var dir = path.join(CHEMDIR, groups.toString());

  var i = 0;
  Prom.map(files, function(p) {
    var f1 = p;
    var nextI = files.indexOf(p) + 1;
    if (nextI > files.length - 1) {
      nextI = files.length - 2;
    }
    var f2 = files[nextI];
    return _compare(f1, f2);
  }, {
    concurrency: 1
  }).then(function(results) {
    groupChemcams(results);
    //Prom.map(results, function(val) {});
  });
}

function _compare(f1, f2) {
  return new Prom(function(resolve, reject) {
    if (!f1 || !f2) {
      resolve();
      return;
    }
    var cmd = 'compare -metric MAE ' + f1 + '  ' + f2 + '  null:';
    ex(cmd, function(s1, s2, s3) {
      //always an error
      if (s1) {
        var val = s1.message.split('null:')[1];
        var val3 = val.split('(')[1];
        var val4 = val3.substring(0, val3.length - 1);
        resolve({
          val: val4,
          f1: f1,
          f2: f2
        });
      } else {
        resolve({
          val: null,
          f1: f1,
          f2: f2
        });
      }
    });
  });
}


function groupChemcams(results) {
  var currentDir;
  console.log(results);
  _.each(results, (r, i) => {
    if (r) {
      var name = nameFromPath(r.f1);
      if (!currentDir) {
        currentDir = path.join(CHEMDIR, name);
      }
      var parsed = path.parse(r.f1);
      var diff = Number(r.val) - CHEM_THRESH;
      console.log(name, ' tresh diff:', diff);
      if (Number(r.val) > CHEM_THRESH) {
        currentDir = path.join(CHEMDIR, name);
        fs.mkdirSync(currentDir);
      }
      fs.copySync(r.f1, path.join(currentDir, parsed.base));
    }
  });

  compareLastAndFirst();
}


function compareLastAndFirst() {
  var files = readDir.readSync(CHEMDIR, ['*/'], readDir.INCLUDE_DIRECTORIES);
  Prom.map(files, (file) => {
    var index = files.indexOf(file);
    var nextFolder = files[index + 1];
    if (nextFolder) {
      var groupFiles = readDir.readSync(path.join(CHEMDIR, file), ['*.jpg'], readDir.ABSOLUTE_PATHS);
      var groupFiles2 = readDir.readSync(path.join(CHEMDIR, nextFolder), ['*.jpg'], readDir.ABSOLUTE_PATHS);
      var img = groupFiles[groupFiles.length - 1];
      var img2 = groupFiles2[0];
      return _compare(img, img2);
    }
  }, {
    concurrency: 1
  }).then((results) => {
    compareLastAndBeforeLast(results)
  });
}

function compareLastAndBeforeLast(lastAndFirst) {
  var files = readDir.readSync(CHEMDIR, ['*/'], readDir.INCLUDE_DIRECTORIES);
  Prom.map(files, (file) => {
    var index = files.indexOf(file);
    var groupFiles = readDir.readSync(path.join(CHEMDIR, file), ['*.jpg'], readDir.ABSOLUTE_PATHS);
    var img = groupFiles[groupFiles.length - 2];
    var img2 = groupFiles[groupFiles.length - 1];
    return _compare(img, img2);
  }, {
    concurrency: 1
  }).then((results) => {
    repositionComparedLastAndFirst(lastAndFirst, results)
  });
}

function repositionComparedLastAndFirst(lastAndFirst, lastBeforeLast) {
  Prom.map(lastAndFirst, (r) => {
    if (r) {
      if (r.val < CHEM_THRESH) {
        var g = _.findWhere(lastBeforeLast, {
          f2: r.f1
        });
        var moveDown = false;
        var dir;
        var toMove;
        var src;
        if (g.val < CHEM_THRESH) {
          moveDown = true;
        }
        if (moveDown) {
          src = r.f2;
          dir = path.parse(r.f1).dir;
          toMove = path.join(dir, path.parse(r.f2).base);
        } else {
          src = r.f1;
          dir = path.parse(r.f2).dir;
          toMove = path.join(dir, path.parse(r.f1).base);
        }
        return move(src, toMove);
      }
    }
  }, {
    concurrency: 1
  });
}



function nameFromPath(p) {
  var v = p.split('_');
  v = v[v.length - 1];
  var v1 = v.substring(0, v.length - 4);
  return v1;
}


rimraf(CHEMDIR, chemcam);
//month
//_doMonth(MONTH, _getDays(YEAR, MONTH)); //['2'])
//_doMonth(MONTH, ['25'])

if (yargs.year) {
  YEAR = yargs.year;
  if (!yargs.month) {
    var m = [];
    for (var i = 1; i < 13; i++) {
      m.push(i);
    }
    Prom.map(m, function(mm) {
      _doMonth(mm, _getDays(yargs.year, mm)); //['2'])
    }, {
      concurrency: 1
    });
  } else {
    _doMonth(yargs.month, _getDays(yargs.year, yargs.month)); //['2'])
  }
}

if (yargs.camera) {

}