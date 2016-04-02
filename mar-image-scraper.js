var r = require('request');
var _ = require('lodash');
var rimraf = require('rimraf');
var fs = require('fs');
var path = require('path');
var yargs = require('yargs').argv;
var Prom = require('bluebird');

//ffmpeg -framerate 18  -pattern_type glob -i "*.jpg" -c:v libx264 -r 30 -pix_fmt yuv420p -y -vf scale=256:256 video.mp4
//http://mwholt.blogspot.co.uk/2014/08/convert-video-to-animated-gif-with.html

//ffmpeg -i input.mp4 -r 20 -f image2pipe -vcodec ppm - | convert -delay 5 - gif:- | convert -layers Optimize - output.gif

//Fgjfq0IkgQ30ElOQnztTuMvmOl2P6D4skJw7tD4m
//Ru46bKZ7yl29jqKB7C9WYd8W91NEeay5TEsrlRAl

//**************************
//convert MAST_2015-02-08_89873.jpg[1x1+10+10] -format "%[fx:int(255*r)],%[fx:int(255*g)],%[fx:int(255*b)]" info:
//**************************
var pages = 100;
var pageCount = 0
var imgs = []
var YEARS = (() => {
    var _years = [];
    while (_years.length < 20) {
        _years.push(2012 + _years.length)
    }
    return _years
}());

var OUTPUT_FOLDER = yargs.dir || 'images';

/*

BROKEN

August
Sept
*/

function _getData(date) {
    var dataDir = yargs.noDateDir ? '/' : date;
    var dir = path.join(__dirname, OUTPUT_FOLDER, dataDir);

    return new Prom(function(resolve, reject) {
        pageCount = 0;

        function __search() {
            var qs = {
                earth_date: date,
                page: pageCount
            };
            if (yargs.camera) {
                qs.camera = yargs.camera;
            }
            var url = "https://api.nasa.gov/mars-photos/api/v1/rovers/curiosity/photos?&api_key=Ru46bKZ7yl29jqKB7C9WYd8W91NEeay5TEsrlRAl";
            r({
                url: url,
                qs: qs
            }, function(err, data, body) {
                var p = JSON.parse(body);
                if (!p.photos) {
                    console.log('No more images');
                    resolve();
                    return;
                }
                if (!p.photos.length) {
                    console.log('No more images');
                    resolve();
                }
                _.each(p.photos, function(i) {
                    imgs.push({
                        dir: dir,
                        url: i.img_src,
                        camera: i.camera.name,
                        date: i.earth_date,
                        id: i.id
                    });
                });
                console.log(imgs.length, ' images for ', date);
                pageCount++;
                if (pageCount < pages) {
                    __search();
                } else {
                    resolve();
                }
            });
        }
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir);
        }
        __search();
    });
}

function _doMonth(year, month, days) {
    return Prom.map(days, function(day) {
        return _getData(year + "-" + month + "-" + day);
    }, {
        concurrency: 1
    }).then(function() {
        return Prom.map(imgs, function(img) {
            return new Prom(function(resolve, reject) {
                var _r = r(img.url);
                _r.pause()
                _r.on('error', function(err) {
                    console.log('failed on: ', img.url);
                    resolve();
                });
                _r.on('response', function(resp) {
                    if (resp.statusCode === 200) {
                        var fileName = path.join(img.dir, `${img.camera}_${img.id}.jpg`);
                        if (!fs.existsSync(fileName)) {
                            var s = fs.createWriteStream(fileName);
                            s.on('error', function(err) {
                                console.log('pipe error on:', img.url);
                                resolve();
                            });
                            s.on('finish', function(err) {
                                console.log('\t Completed', fileName);
                                resolve();
                            });
                            _r.pipe(s);
                            _r.resume();
                        } else {
                            console.log('\t Exists', fileName);
                            resolve();
                        }
                    } else {
                        resolve();
                    }
                });
            });
        }, {
            concurrency: 100
        }).then(function() {});
    })
}

function _doYear(year) {
    if (!yargs.month) {
        var _m = [];
        for (var i = 1; i < 13; i++) {
            _m.push(i);
        }
        return Prom.map(_m, function(mm) {
            return _doMonth(year, mm, _getDays(year, mm));
        }, {
            concurrency: 1
        });
    } else {
        return _doMonth(year, yargs.month, _getDays(year, yargs.month)); //['2'])
    }
}

function _getDays(year, month) {
    var names = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    var date = new Date(year, month - 1, 1);
    var result = [];
    while (date.getMonth() == month - 1) {
        result.push(date.getDate());
        date.setDate(date.getDate() + 1);
    }
    return result;
}


function start() {
    //month
    //_doMonth(MONTH, _getDays(YEAR, MONTH)); //['2'])
    //_doMonth(MONTH, ['25'])

    if (yargs.year) {
        return _doYear(yargs.year)
    } else {
        return Prom.map(YEARS, function(year) {
          console.log(year);
            return _doYear(year)
        }, {
            concurrency: 1
        });
    }
}

if (!fs.existsSync(OUTPUT_FOLDER)) {
    fs.mkdirSync(OUTPUT_FOLDER);
}

start();