/**
 * Provides a generic module for interacting with entities via our REST API
 */
(function () {

  var restPath = '',
    entities = {},
    fetched = {},
    defers = {},
    cache = {};

  angular.module('EntityService', [])
    .config(function () {
      restPath = Drupal.settings.paths.api;
    })
  /**
   * Provider to manage configuration options for EntityService
   */
    .provider('EntityConfig', [function () {
      var config = {};

      function initType(type) {
        config[type] = config[type] || {
          fields: {}
        };
      }

      return {
        $get: [function () {
          return angular.copy(config);
        }],
        addField: function (type, field, value) {
          initType(type);

          config[type].fields[field] = value;
        }
      }
    }])
  /**
   * Service to maintain the list of files on a user's site
   */
    .factory('EntityService', ['$rootScope', '$http', '$q', 'EntityConfig', function ($rootScope, $http, $q, config) {
      var factory = function (entityType, idProp) {
        var type = entityType;
        var ents;
        entities[entityType] = ents = entities[entityType] || {};
        var entityCount = 0;
        var eventName = 'EntityService.' + type;
        var errorAttempts = 0;
        var vsite = null;
        var fetchDefer;

        if (Drupal.settings.spaces) {
          vsite = Drupal.settings.spaces.id;
        }

        var success = function(resp, status, headers, config) {
          var key = config.pKey;
          recursiveFetch(resp, status, headers, config);
        }

        function recursiveFetch(resp, status, headers, config) {
          var key = config.pKey;
          // convert the key into a params array
          for (var i=0; i<resp.data.length; i++) {
            cache[key].data.push(resp.data[i]);
            ents[resp.data[i][idProp]] = resp.data[i];
          }

          if (resp.next) {
            var max = Math.ceil(resp.count/resp.data.length),
              curr = resp.next.href.match(/page=([\d]+)/)[1];
            defers[key].notify(("Loading $p% complete.").replace('$p', Math.round(((curr-1)/max)*100)));
            $http.get(resp.next.href, {pKey: key}).success(recursiveFetch);
          }
          else {
            defers[key].resolve(angular.copy(cache[key].data));
            $rootScope.$broadcast(eventName+'.fetch', angular.copy(cache[key].data), key);
          }
        }

        var errorFunc = function(resp, status, headers, config) {
          errorAttempts++;
          if (errorAttempts < 3) {
            $http.get(restPath + '/' + entityType, config).
              success(success).
              error(errorFunc);
          }
          else {
            defers[config.pKey].reject('Error getting files. Aborting after 3 attempts.');
          }
        };

        function findByProp(prop, value) {
          for (var i in ents) {
            if (ents[i][prop] && ents[i][prop] == value) {
              return i;
            }
          }
        }

        this.fetchOne = function (id) {
          var cKey = entityType + ':' + id;

          if (!defers[cKey]) {
            var url = restPath + '/' + entityType + '/' + id;
            defers[cKey] = $q.defer();
            $http.get(url, {pKey: cKey})
              .then(function (response) {
                ents[id] = response.data.data[0];
                defers[cKey].resolve(angular.copy(response.data.data[0]));
              },
              function (response) {
                defers[cKey].reject(response);
              });
          }
          return defers[cKey].promise;
        }

        this.fetch = function (params) {
          if (!params) {
            params = {};
          }

          if (vsite) {
            params.vsite = vsite;
          }

          if (config[entityType]) {
            for (var k in config[entityType].fields) {
              params[k] = config[entityType].fields[k];
            }
          }

          var key = entityType + ':' + JSON.stringify(params);

          if (!defers[key]) {
            var url = restPath + '/' + entityType;
            defers[key] = $q.defer();
            $http.get(url, {params: params, pKey: key})
              .success(success)
              .error(errorFunc);
            setTimeout(function () {
              defers[key].notify("Loading 0% complete.");
            }, 1);
            cache[key] = {
              lastUpdated: parseInt(Date.now/1000),
              data: [],
              entityType: entityType,
              matches: function(entity, entityType) {
                if (entityType != this.entityType) {
                  return false;
                }
                return testEntity.call(this, entity, params);
              }
            }
          }
          return defers[key].promise;
        }

        this.get = function (id) {
          var k = findByProp(idProp, id);
          if (ents[k]) {
            return ents[k];
          }
        };

        this.getCount = function () {
          return entityCount;
        };

        this.add = function (entity) {
          var k = findByProp(idProp, entity[idProp]);
          if (entities[k]) {
            throw new Exception('Cannot add entity of type ' + type + ' that already exists.');
          }

          if (vsite) {
            entity.vsite = vsite;
          }

          if (config[entityType]) {
            for (var k in config[entityType].fields) {
              params[k] = config[entityType].fields[k];
            }
          }

          // rest API call to add entity to server
          return $http.post(restPath + '/' + entityType, entity)
            .success(function (resp) {
              var entity = resp.data[0];
              ents[entity[idProp]] = entity;

              addToCaches(entityType, idProp, entity);

              $rootScope.$broadcast(eventName + '.add', entity);
            })
        };

        this.edit = function (entity, ignore) {
          if (!entity[idProp]) {
            this.add(entity);
            return;
          }
          ignore = ignore || [];
          ignore.push(idProp);

          var k = findByProp(idProp, entity[idProp]),
            url = [restPath, entityType, entity[idProp]],
            data = getDiff(ents[k], entity, ignore);

          if (data.length) {
            delete data.length;

            return $http.patch(url.join('/'), data)
              .success(function (resp) {
                var entity = resp.data[0],
                  k = findByProp(idProp, entity[idProp]);
                ents[k] = entity;

                $rootScope.$broadcast(eventName + '.update', entity);
                var keys = getCacheKeysForEntity(type, idProp, entity);
                for (var k in keys) {
                  cache[k].data[keys[k]] = entity;
                }
              });
          }
          else {
            var defer = $q.defer();
            defer.resolve({detail: "No data sent with request."});
            return defer.promise;
          }
        };

        this.delete = function (entity) {

          //rest API call to delete entity from server
          return $http.delete(restPath+'/'+entityType+'/'+entity[idProp]).success(function (resp) {
            var k = findByProp(idProp, entity[idProp]);
            delete ents[k];

            $rootScope.$broadcast(eventName+'.delete', entity[idProp]);
            var keys = getCacheKeysForEntity(type, idProp, entity);
            for (var k in keys) {
              cache[k].data.splice(keys[k], 1);
            }
          });
        }

        // registers an entity with this service
        // used for entities that are added outside of this service
        this.register = function (entity) {
          ents[entity[idProp]] = entity;

          addToCaches(entityType, idProp, entity);
        }

        /**
         * Test entity fetched with a set of params to see if it matches a cache
         *
         * Proper usage:
         *  this function should use the cache object as it's 'this', by using the call() method.
         *  Ex. testEntity.call(this, entity, params);
         */
        function testEntity(entity, params) {
          for (var k in params) {
            if (entity[k] == undefined) {
              // this is not something that comes returned on the object
              // try other things
              switch (k) {
                case 'vsite':
                  if (params[k] != vsite) {
                    return false;
                  }
                  break;
              }
            }
            else if (entity[k] != params[k]) {
              return false;
            }
          }
          return true;
        }
      };

      function getDiff(oEntity, nEntity, ignore) {
        var diff = {},
          numProps = 0;

        for (var k in oEntity) {
          if (ignore.indexOf(k) == -1 && !compareProps(oEntity[k], nEntity[k])) {
            diff[k] = nEntity[k];
            numProps++;
          }
        }
        diff.length = numProps;

        return diff;
      }

      return factory;
    }]);

  /**
   * Collect the keys an entity exists in for every cache available
   * TODO: Generate comparator functions on cache creation to test whether entities fit in cache or not
   *
   * @param type - entity type we're searching for
   * @param entity - The entity we're looking for in the caches
   */
  function getCacheKeysForEntity(type, idProp, entity) {
    var keys = {};
    for (var k in cache) {
      // Wrong type.
      if (k.indexOf(type) == -1) {
        continue;
      }

      // TODO: Replace this for loop with comparator function invocation. Should be much faster once those work.
      for (var i = 0; i < cache[k].data.length; i++) {
        if (cache[k].data[i][idProp] == entity[idProp]) {
          keys[k] = i;
        }
      }
    }
    return keys;
  }

  /**
   * Add an entity to all caches it matches
   */
  function addToCaches(type, idProp, entity) {
    var keys = getCacheKeysForEntity(type, idProp, entity);

    for (var k in cache) {
      if (keys[k] != undefined) {
        cache[k].data[keys[k]] = entity;
        continue;
      }

      if (cache[k].matches(entity, type)) {
        cache[k].data.push(entity);
      }
    }
  }

  /*
   * Buncha helper functions for getting comparisons
   */

  /**
   * Compares two properties by value.
   * If property is an array or object, recurses into them.
   * @param prop1
   * @param prop2
   * @returns {boolean}
   */
  function compareProps(prop1, prop2) {
    if (typeof prop1 == 'object') {
      if (prop1 instanceof Array && prop2 instanceof Array) {
        return arrayEquals(prop1, prop2);
      }
      else if (prop1 == null && prop2 == null) {
        return true;
      }
      // rest apis return 'null' instead of an empty array
      // some widgets convert that into an empty array, and thus we need to check here
      else if (prop1 == null && prop2 instanceof Array && prop2.length == 0) {
        return true;
      }
      else if (prop2 == null && prop1 instanceof Array && prop1.length == 0) {
        return true;
      }
      // if neither property is an array, return false as usual
      else if (prop1 == null || prop2 == null) {
        return false;
      }
      else {
        return objectEquals(prop1, prop2);
      }
    }
    else if (typeof(prop1) == typeof(prop2)) {
      return prop1 == prop2;
    }
    else {
      return prop1.toString() == prop2.toString();
    }
  }

  /**
   * Recursively compares 2 arrays by value
   * @param arr1
   * @param arr2
   * @returns {boolean}
   */
  function arrayEquals(arr1, arr2) {
    if (arr1.length != arr2.length) {
      return false;
    }
    else {
      var diff = false;
      for (var i = 0; i < arr1.length; i++) {
        diff = diff || compareProps(arr1[i], arr2[i]);
      }

      return diff;
    }
  }

  /**
   * Recursively compares 2 objects by value
   * @param obj1
   * @param obj2
   * @returns {boolean}
   */
  function objectEquals(obj1, obj2) {
    var keys1 = objectKeys(obj1),
      keys2 = objectKeys(obj2),
      diff = false;

    if (arrayEquals(keys1, keys2)) {
      for (var k in obj1) {
        diff = diff || compareProps(obj1[k], obj2[k]);
      }

      return diff;
    }
    // objects have different keys
    return false;
  }

  /**
   * Returns an array of all keys on the object
   * @param obj
   * @returns {Array}
   */
  function objectKeys(obj) {
    var keys = [];
    for (var k in obj) {
      keys.push(k);
    }
    return keys;
  }
})();
