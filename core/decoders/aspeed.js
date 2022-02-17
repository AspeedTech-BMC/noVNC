/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2021 The noVNC Authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */

import * as Log from '../util/logging.js';
import {decode} from "../../vendor/aspeed/lib/decoder.js";

export default class AspeedDecoder {
    constructor() {
        this._len = 0;
        this._sequence = 0;
        this._ctl = null;
        this._cfg = null;
        this._display = null;

        this._useWorker = window.Worker;

        if (this._useWorker) {
            this._workerInit();
        }

        //Log.initLogging('info');
    }

    _workerInit() {
        this._decodeWorker = new Worker(new URL('./aspeed_worker.js', import.meta.url), { type: "module" });
        this._decodeWorker.onmessage = function(e) {
            this._display.blitImage(0, 0, e.data.width, e.data.height, e.data.buffer, 0, true);
        }.bind(this)
    }

    decodeRect(x, y, width, height, sock, display, depth) {
        if (this._ctl === null) {
            if (sock.rQwait("TIGHT compression-control", 1)) {
                return false;
            }

            this._ctl = sock.rQshift8();

            // jammy: need reset policy???
            // Reset streams if the server requests it
            for (let i = 0; i < 4; i++) {
                if ((this._ctl >> i) & 1) {
                    //this._zlibs[i].reset();
                    Log.Info("Reset zlib stream " + i);
                }
            }

            // Figure out filter
            this._ctl = this._ctl >> 4;
        }

        let ret;

        if (this._ctl === 0x09) {
            ret = this._jpegRect(x, y, width, height,
                                 sock, display, depth);
        } else if (this._ctl === 0x0A) {
            ret = this._pjpegRect(x, y, width, height,
                                  sock, display, depth);
        } else if ((this._ctl & 0x80) == 0) {
            ret = this._basicRect(this._ctl, x, y, width, height,
                                  sock, display, depth);
        } else {
            throw new Error("Illegal aspeed compression received (ctl: " +
                                   this._ctl + ")");
        }

        if (ret) {
            this._ctl = null;
        }

        return ret;
    }

    _jpegRect(x, y, width, height, sock, display, depth) {
        let data = this._readData(sock);
        if (data === null) {
            return false;
        }

        display.imageRect(x, y, width, height, "image/jpeg", data);

        return true;
    }

    _pjpegRect(x, y, width, height, sock, display, depth) {
        if (this._cfg === null) {
            if (sock.rQwait("ASPEED", 8)) {
                return false;
            }

            let x = sock.rQshift16();
            let y = sock.rQshift16();
            let w = sock.rQshift16();
            let h = sock.rQshift16();
            this._cfg = {x:x,y:y,w:w,h:h};
        }

        let data = this._readData(sock);
        if (data === null) {
            return false;
        }

        //Log.Info(this._cfg);
        display.imageRect(this._cfg.x, this._cfg.y, this._cfg.w, this._cfg.h, "image/jpeg", data);

        this._cfg = null;
        return true;
    }

    _basicRect(ctl, x, y, width, height, sock, display, depth) {
        if (this._cfg === null) {
            if (sock.rQwait("ASPEED", 6)) {
                return false;
            }

            this._sequence = sock.rQshift32();
            this._cfg = sock.rQshift16();
        }

        let data = this._readData(sock);
        if (data === null) {
            return false;
        }

        if (this._useWorker && this._decodeWorker) {
            this._display = display;
            try {
                let copy = data.slice();
                this._decodeWorker.postMessage({
                    header: {
                        frame: this._sequence,
                        mode420: this._cfg >> 8,
                        selector: (this._cfg & 0x0f).clamp(0, 7),
                        advance_selector: ((this._cfg >> 4) & 0x0f).clamp(0, 7),
                        width: width,
                        height: height,
                    },
                    buffer: copy
                }, [copy.buffer]);
            } catch (e) {
                this._decodeWorker.terminate();
                this._decodeWorker = null;
                console.error(e);
                setTimeout(this._workerInit(), 500);
            }
        } else {
            let outbuf = decode({
                frame: this._sequence,
                mode420: ctl & 0x1,
                selector: (this._cfg & 0x0f).clamp(0, 7),
                advance_selector: ((this._cfg >> 4) & 0x0f).clamp(0, 7),
                width: width,
                height: height}, data);
            display.blitImage(x, y, width, height, outbuf, 0, false);
        }

        this._cfg = null;
        return true;
    }

    _readData(sock) {
        if (this._len === 0) {
            if (sock.rQwait("ASPEED", 3)) {
                return null;
            }

            let byte;

            byte = sock.rQshift8();
            this._len = byte & 0x7f;
            if (byte & 0x80) {
                byte = sock.rQshift8();
                this._len |= (byte & 0x7f) << 7;
                if (byte & 0x80) {
                    byte = sock.rQshift8();
                    this._len |= byte << 14;
                }
            }
        }

        if (sock.rQwait("ASPEED", this._len)) {
            return null;
        }

        let data = sock.rQshiftBytes(this._len);
        this._len = 0;

        return data;
    }
}
