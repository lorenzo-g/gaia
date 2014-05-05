/*jshint maxlen:false*/

suite('app', function() {
  'use strict';

  suiteSetup(function(done) {
    var self = this;

    window.req([
      'app',
      'lib/camera',
      'vendor/view',
      'lib/geo-location',
      'lib/activity',
      'lib/setting',
    ], function(App, Camera, View, GeoLocation, Activity, Setting) {
      self.App = App;
      self.View = View;
      self.Camera = Camera;
      self.Geolocation = GeoLocation;
      self.Activity = Activity;
      self.Setting = Setting;
      done();
    });
  });

  var mocks = {
    doc: function() {
      return {
        addEventListener: sinon.spy(),
        hidden: false
      };
    },
    win: function() {
      return {
        addEventListener: sinon.spy(),
        location: {
          hash: ''
        }
      };
    }
  };

  setup(function() {
    var self = this;

    if (!navigator.mozCameras) {
      navigator.mozCameras = {
        getListOfCameras: function() { return []; },
        getCamera: function() {},
        release: function() {}
      };
    }

    navigator.mozL10n = { readyState: null };

    var options = this.options = {
      doc: mocks.doc(),
      win: mocks.win(),
      el: document.createElement('div'),
      geolocation: sinon.createStubInstance(this.Geolocation),
      activity: new this.Activity(),
      camera: sinon.createStubInstance(this.Camera),
      require: sinon.stub(),
      settings: {
        geolocation: sinon.createStubInstance(this.Setting),
        loadingScreen: sinon.createStubInstance(this.Setting)
      },
      views: {
        viewfinder: new this.View({ name: 'viewfinder' }),
        focusRing: new this.View({ name: 'focus-ring' }),
        hud: new this.View({ name: 'hud' })
      },
      controllers: {
        hud: sinon.spy(),
        timer: sinon.spy(),
        controls: sinon.spy(),
        viewfinder: sinon.spy(),
        overlay: sinon.spy(),
        camera: sinon.spy(),
        settings: sinon.spy(),
        activity: sinon.spy(),
        recordingTimer: sinon.spy(),
        zoomBar: sinon.spy(),
        indicators: sinon.spy(),

        // Lazy loaded
        previewGallery: 'controllers/preview-gallery',
        storage: 'controllers/storage',
        confirm: 'controllers/confirm',
        battery: 'controllers/battery',
        sounds: 'controllers/sounds'
      }
    };

    this.loadingView = sinon.createStubInstance(this.View);
    this.loadingView.appendTo.returns(this.loadingView);
    options.LoadingView = function() { return self.loadingView; };

    // Sandbox to put all our stubs in
    this.sandbox = sinon.sandbox.create();

    // Sinon take over setTimeout
    this.clock = sinon.useFakeTimers();

    // Stub out all methods
    this.sandbox.stub(options.activity);
    this.sandbox.stub(options.viewfinder);
    this.sandbox.stub(options.focusRing);
    this.sandbox.stub(options.hud);

    // More complex stubs
    options.activity.check.callsArg(0);
    this.sandbox.spy(this.App.prototype, 'boot');

    // Aliases
    this.settings = options.settings;

    // Create the app
    this.app = new this.App(options);

    this.sandbox.spy(this.app, 'on');
    this.sandbox.spy(this.app, 'set');
    this.sandbox.spy(this.app, 'once');
    this.sandbox.spy(this.app, 'emit');
    this.sandbox.spy(this.app, 'firer');
  });

  teardown(function() {
    this.sandbox.restore();
    this.clock.restore();
    delete navigator.mozCameras;
  });

  suite('App()', function() {
    test('Should store the injected dependencies on the instance', function() {
      var options = this.options;
      var app = this.app;

      assert.ok(app.el === options.el);
      assert.ok(app.inSecureMode === false);
      assert.ok(app.geolocation === options.geolocation);
      assert.ok(app.camera === options.camera);
      assert.ok(app.storage === options.storage);
      assert.ok(app.settings === options.settings);
      assert.ok(app.sounds === options.sounds);
      assert.ok(app.controllers === options.controllers);
    });

    test('Should detect secure mode', function() {
      var options = this.options;
      options.win.location.hash = '#secure';

      // need to `new App()` again here (and disregard `this.app`)
      // because we have changed the option mock.
      var app = new this.App(options);

      assert.ok(app.inSecureMode === true);
    });
  });

  suite('App#boot()', function() {
    setup(function() {
      this.app.boot();
    });

    test('Should run each of the controllers,' +
         'passing itself as first argument', function() {
      var controllers = this.app.controllers;
      var app = this.app;

      assert.ok(controllers.hud.calledWith(app));
      assert.ok(controllers.controls.calledWith(app));
      assert.ok(controllers.viewfinder.calledWith(app));
      assert.ok(controllers.overlay.calledWith(app));
      assert.ok(controllers.camera.calledWith(app));
      assert.ok(controllers.zoomBar.calledWith(app));
    });

    test('Should put each of the views into the root element', function() {
      var el = this.app.el;

      assert.ok(el.querySelector('.viewfinder'));
      assert.ok(el.querySelector('.focus-ring'));
      assert.ok(el.querySelector('.hud'));
    });

    test('Should bind to `visibilitychange` event', function() {
      var call = this.app.doc.addEventListener.getCall(0);
      assert.ok(call.args[0] === 'visibilitychange');
      assert.ok(typeof call.args[1] === 'function');
    });

    test('Should bind to `beforeunload` event', function() {
      var addEventListener = this.app.win.addEventListener;
      assert.ok(addEventListener.calledWith('beforeunload', this.app.onBeforeUnload));
    });

    test('Should run the activity controller before controls or camera', function() {
      var activity = this.app.controllers.activity;
      var controls = this.app.controllers.controls;
      var camera = this.app.controllers.camera;

      assert.isTrue(activity.calledBefore(controls));
      assert.isTrue(activity.calledBefore(camera));
    });

    test('Should watch location only once storage confirmed healthy', function() {
      var geolocationWatch = this.app.geolocationWatch;
      assert.ok(this.app.once.calledWith('storage:checked:healthy', geolocationWatch));
    });

    suite('App#geolocationWatch()', function() {
      test('Should *not* watch location if in activity', function() {
        this.app.hidden = false;
        this.app.activity.pick = true;

        this.app.geolocationWatch();
        this.clock.tick(2000);

        assert.isFalse(this.app.geolocation.watch.called);
      });

      test('Should *not* watch location if app hidden', function() {
        this.app.hidden = true;
        this.app.activity.pick = false;

        this.app.geolocationWatch();
        this.clock.tick(2000);

        assert.isFalse(this.app.geolocation.watch.called);
      });
    });

    suite('once(\'viewfinder:visible\')', function() {
      setup(function() {

        // Stop annoying logs
        this.sandbox.stub(console, 'log');

        this.spy = this.app.once.withArgs('viewfinder:visible');
        this.callback = this.spy.args[0][1];

        sinon.stub(this.app, 'clearLoading');
        sinon.spy(this.app, 'loadController');
        sinon.spy(this.app, 'loadL10n');

        // Call the callback to test
        this.callback();
      });

      test('Should fire a `criticalpathdone` event', function() {
        assert.isTrue(this.app.emit.calledWith('criticalpathdone'));
      });

      test('Should flag `this.criticalPathDone`', function() {
        assert.isTrue(this.app.criticalPathDone);
      });

      test('Should load l10n', function() {
        assert.isTrue(this.app.loadL10n.calledOnce);
      });

      test('Should load non-critical controllers', function() {
        var loadController = this.app.loadController;
        var controllers = this.app.controllers;

        assert.isTrue(loadController.calledWith(controllers.previewGallery));
        assert.isTrue(loadController.calledWith(controllers.storage));
        assert.isTrue(loadController.calledWith(controllers.confirm));
        assert.isTrue(loadController.calledWith(controllers.battery));
        assert.isTrue(loadController.calledWith(controllers.sounds));
      });

      test('Should clear loading screen', function() {
        sinon.assert.called(this.app.clearLoading);
      });
    });
  });

  suite('App#bindEvents()', function() {
    setup(function() {
      this.app.bindEvents();
    });

    test('Should listen for visibilitychange on document', function() {
      assert.isTrue(this.app.doc.addEventListener.calledWith('visibilitychange'));
    });

    test('Should relay window \'localized\' event', function() {
      assert.isTrue(this.app.win.addEventListener.calledWith('localized'));
      assert.isTrue(this.app.firer.calledWith('localized'));
    });
  });

  suite('App#onVisibilityChange', function() {

    test('Should update the `app.hidden` property', function() {
      this.app.doc.hidden = true;
      this.app.onVisibilityChange();
      assert.equal(this.app.hidden, true);

      this.app.doc.hidden = false;
      this.app.onVisibilityChange();
      assert.equal(this.app.hidden, false);
    });

    test('Should emit a \'visible\' event when the document is not hidden', function() {
      this.app.doc.hidden = false;
      this.app.onVisibilityChange();
      assert.isTrue(this.app.emit.calledWith('visible'));
    });

    test('Should emit a \'hidden\' event when the document is hidden', function() {
      this.app.doc.hidden = true;
      this.app.onVisibilityChange();
      assert.isTrue(this.app.emit.calledWith('hidden'));
    });
  });

  suite('App#onHidden', function() {
    setup(function() {
      this.app.onHidden();
    });

    test('Should stop watching location', function() {
      assert.ok(this.app.geolocation.stopWatching.called);
    });
  });

  suite('App#onVisible()', function() {
    setup(function() {
      sinon.spy(this.app, 'geolocationWatch');
      this.app.onVisible();
    });

    test('Should begin watching location again', function() {
      assert.ok(this.app.geolocationWatch.called);
    });
  });

  suite('App#loadL10n()', function() {
    test('Should require l10n', function() {
      this.app.loadL10n();
      assert.equal(this.app.require.args[0][0][0], 'l10n');
    });
  });

  suite('App#showLoading()', function() {
    setup(function() {
      this.settings.loadingScreen.get.withArgs('delay').returns(400);
      this.sandbox.spy(window, 'clearTimeout');
    });

    test('Should append a loading view to the app element and show', function() {
      this.app.showLoading();
      this.clock.tick(400);
      sinon.assert.calledWith(this.app.views.loading.appendTo, this.app.el);
      sinon.assert.called(this.app.views.loading.show);
    });

    test('Should clear any existing timeouts', function() {
      this.sandbox.stub(window, 'setTimeout').returns('<timeout-id>');
      this.app.showLoading();
      this.app.showLoading();
      sinon.assert.calledWith(window.clearTimeout, '<timeout-id>');
    });
  });

  suite('App#clearLoading()', function() {
    setup(function() {
      this.sandbox.spy(window, 'clearTimeout');
      this.sandbox.stub(window, 'setTimeout').returns('<timeout-id>');
      this.app.views.loading = sinon.createStubInstance(this.View);
      this.app.views.loading.hide.callsArg(0);
    });

    test('Should clear loadingTimeout', function() {
      this.app.showLoading();
      this.app.clearLoading();
      sinon.assert.calledWith(window.clearTimeout, '<timeout-id>');
    });

    test('Should hide, then destroy the view', function() {
      var view = this.app.views.loading;
      this.app.clearLoading();

      sinon.assert.called(view.hide);
      assert.ok(view.destroy.calledAfter(view.hide));
    });
  });
});