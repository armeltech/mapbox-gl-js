// @flow

import {Evented, ErrorEvent, Event} from '../../src/util/evented.js';
import type {Source} from '../../src/source/source.js';
import type Tile from '../../src/source/tile.js';
import type {Callback} from '../../src/types/callback.js';
import type {Cancelable} from '../../src/types/cancelable.js';
import type Dispatcher from '../../src/util/dispatcher.js';
import {ResourceType} from '../../src/util/ajax.js';
import type {ModelSourceSpecification} from '../../src/style-spec/types.js';
import type Map from '../../src/ui/map.js';
import loadTileJSON from '../../src/source/load_tilejson.js';
import TileBounds from '../../src/source/tile_bounds.js';
import {extend} from '../../src/util/util.js';
import {postTurnstileEvent} from '../../src/util/mapbox.js';

class Tiled3DModelSource extends Evented implements Source {
    type: 'batched-model';
    id: string;
    minzoom: number;
    maxzoom: number;
    tileBounds: TileBounds;
    roundZoom: boolean | void;
    reparseOverscaled: boolean | void;
    tileSize: number;
    tiles: Array<string>;
    dispatcher: Dispatcher;
    scheme: string;
    _loaded: boolean;
    _options: ModelSourceSpecification;
    _tileJSONRequest: ?Cancelable;
    map: Map;
    /**
     * @private
     */
    // eslint-disable-next-line no-unused-vars
    constructor(id: string, options: ModelSourceSpecification, dispatcher: Dispatcher, eventedParent: Evented) {
        super();
        this.type = 'batched-model';
        this.id = id;
        this.tileSize = 512;

        this._options = options;
        this.tiles = (this._options.tiles: any);
        this.maxzoom = options.maxzoom || 19;
        this.minzoom = options.minzoom || 0;
        this.roundZoom = true;
        this.dispatcher = dispatcher;
        this.reparseOverscaled = true;
        this.scheme = 'xyz';
        this._loaded = false;
        this.setEventedParent(eventedParent);
    }
    // $FlowFixMe[method-unbinding]
    onAdd(map: Map) {
        this.map = map;
        this.load();
    }

    load(callback?: Callback<void>) {
        this._loaded = false;
        this.fire(new Event('dataloading', {dataType: 'source'}));
        const language = Array.isArray(this.map._language) ? this.map._language.join() : this.map._language;
        const worldview = this.map._worldview;
        this._tileJSONRequest = loadTileJSON(this._options, this.map._requestManager, language, worldview, (err, tileJSON) => {
            this._tileJSONRequest = null;
            this._loaded = true;
            if (err) {
                if (language) console.warn(`Ensure that your requested language string is a valid BCP-47 code or list of codes. Found: ${language}`);
                if (worldview && worldview.length !== 2) console.warn(`Requested worldview strings must be a valid ISO alpha-2 code. Found: ${worldview}`);

                this.fire(new ErrorEvent(err));
            } else if (tileJSON) {
                extend(this, tileJSON);
                if (tileJSON.bounds) this.tileBounds = new TileBounds(tileJSON.bounds, this.minzoom, this.maxzoom);
                postTurnstileEvent(tileJSON.tiles, this.map._requestManager._customAccessToken);

                // `content` is included here to prevent a race condition where `Style#_updateSources` is called
                // before the TileJSON arrives. this makes sure the tiles needed are loaded once TileJSON arrives
                // ref: https://github.com/mapbox/mapbox-gl-js/pull/4347#discussion_r104418088
                this.fire(new Event('data', {dataType: 'source', sourceDataType: 'metadata'}));
                this.fire(new Event('data', {dataType: 'source', sourceDataType: 'content'}));
            }

            if (callback) callback(err);
        });
    }

    hasTransition(): boolean {
        return false;
    }

    loaded(): boolean {
        return this._loaded;
    }

    loadTile(tile: Tile, callback: Callback<void>) {
        const url = this.map._requestManager.normalizeTileURL(tile.tileID.canonical.url((this.tiles: any), this.scheme));
        const request = this.map._requestManager.transformRequest(url, ResourceType.Tile);
        const params = {
            request,
            data: undefined,
            uid: tile.uid,
            tileID: tile.tileID,
            tileZoom: tile.tileZoom,
            zoom: tile.tileID.overscaledZ,
            tileSize: this.tileSize * tile.tileID.overscaleFactor(),
            type: this.type,
            source: this.id,
            showCollisionBoxes: this.map.showCollisionBoxes,
            isSymbolTile: tile.isSymbolTile
        };
        if (!tile.actor || tile.state === 'expired') {
            tile.actor = this.dispatcher.getActor();
        }
        tile.request = tile.actor.send('loadTile', params, done.bind(this), undefined, true);

        function done(err, data) {
            if (tile.aborted)
                return callback(null);

            if (err) {
                return callback(err);
            }
            if (data && data.resourceTiming)
                tile.resourceTiming = data.resourceTiming;
            if (this.map._refreshExpiredTiles && data) tile.setExpiryData(data);

            tile.buckets = {...tile.buckets, ...data.buckets};
            tile.state = 'loaded';
            callback(null);
        }
    }

    serialize(): Object {
        return {
            type: 'batched-model'
        };
    }
}

export default Tiled3DModelSource;
