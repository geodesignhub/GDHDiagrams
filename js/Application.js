/*
 Copyright 2022 Esri

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

class Application extends EventTarget {

  static CONFIG = {
    PORTAL_URL: "https://www.arcgis.com",
    OAUTH_APP_ID: "PZdAgiu187TroTCX"
  };

  /**
   *
   */
  constructor() {
    super();

    // INITIALIZE PORTAL //
    this.initializeApplication().then(({portal}) => {

      // SIGNED-IN USER LABEL //
      const signInUserLabel = document.getElementById('sign-in-user-label');
      signInUserLabel.innerHTML = portal.user?.username || '[ not signed in ]';

      // INITIALIZE GROUP CONTENT SELECTION //
      //this.initializeGroupSelection({portal});

      // INITIALIZE MAP VIEW //
      this.initializeMapView().then(({view}) => {

        // INITIALIZE MANAGEMENT OF MAP LAYERS //
        this.initializeMapLayers({view});

        // INITIALIZE SKETCH TOOLS //
        this.initializeSketchTools({view});

        // INITIALIZE ANALYSIS //
        this.initializeAnalysis({view});

        // GEOPLANNER LAYERS //
        this.initializeGeoPlannerLayers({portal});

      });
    });

  }

  /**
   *
   * @returns {Promise<Portal>}
   */
  initializeApplication() {
    return new Promise((resolve, reject) => {
      require([
        'esri/identity/IdentityManager',
        'esri/identity/OAuthInfo',
        'esri/portal/Portal'
      ], (esriId, OAuthInfo, Portal) => {

        // CONFIGURE OAUTH //
        const oauthInfo = new OAuthInfo({
          portalUrl: Application.CONFIG.PORTAL_URL,
          appId: Application.CONFIG.OAUTH_APP_ID,
          popup: true
        });
        esriId.registerOAuthInfos([oauthInfo]);

        // PORTAL //
        const portal = new Portal({url: Application.CONFIG.PORTAL_URL});

        // SHARING URL //
        const portalSharingURL = `${ Application.CONFIG.PORTAL_URL }/sharing`;

        // CHECK THE SIGN-IN STATUS
        esriId.checkSignInStatus(portalSharingURL).then(() => {
          return esriId.getCredential(portalSharingURL);
        }).catch(() => {
          // IF USER IS NOT SIGNED IN THEN ASK THE USER TO SIGN IN NOW... //
          portal.authMode = 'immediate';
        }).then(() => {
          // LOAD PORTAL //
          portal.load().then(() => {
            console.info(`Signed in user: ${ portal.user?.username || 'none' }`);
            resolve({portal});
          }).catch(reject);
        });
      });

    });
  }

  /**
   *
   * @returns {Promise<MapView>}
   */
  initializeMapView() {
    return new Promise((resolve, reject) => {
      require([
        'esri/core/reactiveUtils',
        'esri/Map',
        'esri/views/MapView',
        "esri/widgets/Expand",
        'esri/widgets/Home',
        'esri/widgets/Search',
        'esri/widgets/Legend',
        'esri/widgets/LayerList',
        'esri/widgets/Slider'
      ], (reactiveUtils, EsriMap, MapView, Expand, Home, Search, Legend, LayerList, Slider) => {

        // MAP VIEW CONTAINER ELEMENT ID //
        const mapViewContainerId = 'view-container';

        // CREATE MAP VIEW //
        const view = new MapView({
          container: mapViewContainerId,
          map: new EsriMap({
            basemap: 'topo-vector'
          }),
          constraints: {snapToZoom: false},
          zoom: 5,
          center: [-97.0, 38.0],
          popup: {
            dockEnabled: true,
            dockOptions: {
              buttonEnabled: false,
              breakpoint: false,
              position: "bottom-left"
            }
          }
        });
        view.when(() => {
          // WHEN THE VIEW IS CREATED //

          // SEARCH //
          const search = new Search({view});
          const searchExpand = new Expand({view, content: search});
          view.ui.add(searchExpand, {position: 'top-left', index: 0});

          // HOME //
          const home = new Home({view});
          view.ui.add(home, {position: 'top-left', index: 1});

          // LEGEND //
          const legend = new Legend({container: 'legend-container', view});

          const fullExtentAction = {
            id: "full-extent",
            type: 'button',
            title: "Go to full extent",
            className: "esri-icon-zoom-out-fixed"
          };

          const blendModeAction = {
            id: "blend-mode",
            type: 'toggle',
            value: false,
            title: "Blend Mode: multiply"
          };

          // LAYER LIST //
          const layerList = new LayerList({
            container: 'layer-list-container',
            view: view,
            visibleElements: {statusIndicators: true},
            listItemCreatedFunction: ({item}) => {

              const slider = new Slider({
                min: 0, max: 1, precision: 2, values: [item.layer.opacity],
                visibleElements: {labels: false, rangeLabels: true}
              });
              slider.on("thumb-drag", (event) => {
                item.layer.opacity = event.value;
              });

              const itemActions = [
                {...blendModeAction, value: (item.layer.blendMode === 'multiply')}
              ];
              if (item.layer.type !== 'group') {
                itemActions.push(fullExtentAction);
              }

              item.set({
                open: true,
                actionsOpen: true,
                panel: {
                  open: true,
                  title: 'opacity',
                  className: "esri-icon-experimental",
                  content: slider
                },
                actionsSections: [itemActions]
              });
            }
          });

          layerList.on("trigger-action", (evt) => {
            const id = evt.action.id;
            if (id === "full-extent") {
              view.goTo(evt.item.layer.fullExtent.clone().expand(1.1));
            }
            if (id === "blend-mode") {
              evt.item.layer.blendMode = evt.action.value ? 'multiply' : 'normal';
            }
          });

          resolve({view});
        });
      });
    });
  }

  /**
   *
   * @param {MapView} view
   */
  initializeMapLayers({view}) {
    require([
      'esri/layers/Layer'
    ], (Layer) => {

      const sourceLayerInput = document.getElementById('source-layer-input');

      // LIST OF LAYERS BY PORTAL ITEM ID //
      const layerByPortalItemID = new Map();

      //
      // HERE WE ASSUME THAT THE GEOPLANNER SCENARIO LAYER HAS TWO LAYERS
      // SO THE HYDRATED LAYER IS A GROUP LAYER WITH TWO FEATURE LAYERS
      //
      // NOTE: THIS LOGIC WILL CHANGE AS WE ADAPT TO AN AGREED UPON
      //       CONFIGURATION OF LAYERS AND SCHEMAS...
      //
      const _setAnalysisSource = (layer) => {
        if (layer?.layers) {

          const interventionsLayer = layer.layers.find(l => l.title.toLowerCase().includes('interventions'));

          sourceLayerInput.value = interventionsLayer.title;
          this.setAnalysisLayer({layer: interventionsLayer});

        } else {
          sourceLayerInput.value = null;
          this.setAnalysisLayer({layer: null});
        }

        /*if (layer.type === 'feature') {
         sourceLayerInput.value = portalItem.title;
         this.setAnalysisLayer({layer});
         }*/

      };

      // TOGGLE LAYER INCLUSION IN MAP //
      this.addEventListener('layer-toggle', ({detail: {portalItem, selected}}) => {
        // DO WE HAVE THE LAYER CACHED? //
        const layer = layerByPortalItemID.get(portalItem.id);

        // SHOULD WE ADD OF REMOVE THE LAYER FROM THE MAP? //
        if (selected) {

          // DO WE ALREADY HAVE THE LAYER CACHED? //
          if (layer) {
            // THEN JUST ADD TO THE MAP //
            view.map.add(layer, 0);

            _setAnalysisSource(layer);

          } else {
            // THEN CREATE DIRECTLY FROM PORTAL ITEM //
            Layer.fromPortalItem(portalItem).then((mapLayer) => {

              // CACHE LAYER SO WE DON'T HAVE TO CREATE IT AGAIN IN THIS SESSION //
              layerByPortalItemID.set(portalItem.id, mapLayer);

              mapLayer.loadAll().then(() => {

                // ADD LAYER TO MAP //
                view.map.add(mapLayer, 0);

                _setAnalysisSource(mapLayer);

              });
            });
          }

        } else {
          // THE MAP LAYER SHOULD ALREADY BE CACHED SO REMOVE IT FROM THE MAP //
          layer && view.map.remove(layer);
          _setAnalysisSource();
        }
      });

      // CLEAR OPERATIONAL LAYERS FROM THE MAP //
      this.addEventListener('layers-clear', () => {
        const notGraphicsLayers = view.map.layers.filter(layer => layer.type !== 'graphics');
        view.map.removeMany(notGraphicsLayers);

        sourceLayerInput.value = null;
        this.setAnalysisLayer({layer: null});
      });

    });
  }

  /**
   *
   * @param {MapView} view
   */
  initializeSketchTools({view}) {
    require([
      'esri/core/reactiveUtils',
      'esri/layers/GraphicsLayer',
      "esri/widgets/Expand",
      'esri/widgets/Sketch'
    ], (reactiveUtils, GraphicsLayer, Expand, Sketch) => {

      // SKETCH LAYER //
      const sketchLayer = new GraphicsLayer({listMode: 'hide'});
      view.map.add(sketchLayer);

      // SKETCH //
      const sketch = new Sketch({
        view,
        layer: sketchLayer,
        creationMode: 'single',
        availableCreateTools: ['polygon', 'rectangle', 'circle'],
        defaultCreateOptions: {mode: 'hybrid'},
        visibleElements: {
          selectionTools: {
            "rectangle-selection": false,
            "lasso-selection": false
          }
        }
      });

      // WHEN A NEW SKETCH HAS BEEN CREATED //
      sketch.on("create", (event) => {
        if (event.state === "complete") {
          this.dispatchEvent(new CustomEvent('analysis-geometry', {detail: {geometry: event.graphic.geometry}}));
        }
      });

      // SKETCH EXPAND //
      const sketchExpand = new Expand({view, content: sketch});
      view.ui.add(sketchExpand, {position: 'top-right', index: 0});

    });
  }

  /**
   *
   * @param {PortalItem} layerPortalItem
   * @returns {HTMLElement}
   */
  createLayerListItem(layerPortalItem) {

    const layerListItem = document.createElement('calcite-pick-list-item');
    layerListItem.setAttribute('value', layerPortalItem.id);
    layerListItem.setAttribute('label', layerPortalItem.title);
    layerListItem.setAttribute('description', `Type: ${ layerPortalItem.displayName } | Source: ${ layerPortalItem.type }`);
    layerListItem.setAttribute('title', layerPortalItem.snippet);

    const layerAction = document.createElement('calcite-action');
    layerAction.setAttribute('slot', 'actions-start');
    layerAction.toggleAttribute('compact', true);
    layerListItem.append(layerAction);

    const layerIcon = document.createElement('img');
    layerIcon.src = layerPortalItem.iconUrl;
    layerAction.append(layerIcon);

    layerListItem.addEventListener('calciteListItemChange', ({detail: {selected}}) => {
      this.dispatchEvent(new CustomEvent('layer-toggle', {detail: {portalItem: layerPortalItem, selected}}));
    });

    return layerListItem;
  }

  /**
   *
   * @param portal
   */
  initializeGeoPlannerLayers({portal}) {

    const geoPlannerLayersList = document.getElementById('geoplanner-layers-list');

    if (portal) {

      //
      // ASK PORTAL TO RETURN PORTAL ITEMS      //
      //  - IGC | geodesign | geodesignScenario //
      //
      portal.queryItems({
        query: 'tags:(IGC AND geodesign AND geodesignScenario)',
        sortField: 'modified',
        sortOrder: 'desc',
        num: 100
      }).then(({results}) => {

        // LAYER PORTAL ITEMS //
        const layerPortalItems = results.filter(item => item.isLayer);

        // LAYER LIST ITEMS //
        const layerListItems = layerPortalItems.map(this.createLayerListItem.bind(this));

        // ADD LAYER LIST ITEMS //
        geoPlannerLayersList.replaceChildren(...layerListItems);
      });

    } else {
      geoPlannerLayersList.replaceChildren();
    }
  }

  /**
   *
   * @param {MapView} view
   */
  initializeAnalysis({view}) {

    let analysisLayer = null;
    this.setAnalysisLayer = ({layer}) => {
      analysisLayer = layer;
      _getInterventions();
    };

    const _getInterventions = () => {
      if (analysisLayer) {

        const analysisQuery = analysisLayer.createQuery();
        analysisQuery.set({
          where: `Intervention_type IS NOT NULL`,
          outFields: ['Geodesign_ProjectID', 'Geodesign_ScenarioID', 'Intervention_type'],
          returnDistinctValues: true,
          returnGeometry: false
        });

        analysisLayer.queryFeatures(analysisQuery).then(analysisFS => {

          console.info(analysisFS.features)

        });
      }

    };

    this.addEventListener('analysis-geometry', ({detail: {geometry}}) => {
      if (analysisLayer) {
        view.whenLayerView(analysisLayer).then(analysisLayerView => {

          const analysisQuery = analysisLayerView.createQuery();
          analysisQuery.set({
            where: `1=1`,
            geometry
          });

          analysisLayerView.queryFeatures(analysisQuery).then(analysisFS => {
            // SELECTED FEATURES //
            const selectedFeatures = analysisFS.features;

            //
            // DO SOMETHING WITH SELECTED FEATURES //
            //
            view.popup.open({features: selectedFeatures});

          });
        });
      }
    });

  }

}

export default new Application();
