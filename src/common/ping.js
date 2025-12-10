'use-strict';

import nodejsTcpPing from 'nodejs-tcp-ping';
import ping from 'ping';
import { URL } from 'url';
import fs from 'fs';
import path from 'path';

import LoggerService from '../services/logger/logger.service.js';

export default class Ping {
  static async status(camera, timeout = 1) {
    try {
      console.log('=== PING CALLED ===');
      console.log('Camera name:', camera.name);
      console.log('Camera source:', camera.videoConfig.source);

      const { log } = LoggerService;

      //fix for non-break-spaces
      let cameraSource = camera.videoConfig.source.replace(/\u00A0/g, ' ').split('-i ')[1];

      if (!cameraSource) {
        log.warn(`Can not ping camera source, no source found (${camera.videoConfig.source})`, camera.name);
        return false;
      }

      cameraSource = cameraSource.trim();

      console.log('CameraSource:', cameraSource);
      console.log('CWD:', process.cwd());

      log.debug(`Incoming ping request for: ${cameraSource} - Timeout: ${timeout}s`, camera.name);

      // Для локальных файлов (Unix и Windows)
      if (cameraSource.startsWith('/') ||
        cameraSource.startsWith('./') ||
        cameraSource.startsWith('../') ||
        /^[A-Za-z]:[\\\/]/.test(cameraSource) ||
        cameraSource.includes('\\') ||
        cameraSource.endsWith('.mp4') ||
        cameraSource.endsWith('.avi') ||
        cameraSource.endsWith('.mkv') ||
        cameraSource.endsWith('.mov')) {

        console.log('Detected as local file');

        try {
          const fullPath = path.resolve(process.cwd(), cameraSource);
          console.log('Full path:', fullPath);
          const exists = fs.existsSync(fullPath);
          console.log('File exists:', exists);

          log.debug(`Local file check: ${fullPath} - ${exists ? 'exists' : 'not found'}`, camera.name);
          return exists;
        } catch (error) {
          console.log('File check error:', error);
          log.debug(`Local file check error: ${error.message}`, camera.name);
          return false;
        }
      }

      console.log('Not a local file, trying as URL');

      // Для URL (сетевые камеры)
      try {
        const url = new URL(cameraSource);

        log.debug(`Pinging ${url.hostname}:${url.port || 80}`, camera.name);

        let available = false;

        try {
          const response = await nodejsTcpPing.tcpPing({
            attempts: 5,
            host: url.hostname,
            port: Number.parseInt(url.port) || 80,
            timeout: (timeout || 1) * 1000,
          });

          available = response.filter((result) => result.ping).length > 2;
        } catch {
          //ignore
        }

        if (!available) {
          const response = await ping.promise.probe(url.hostname, {
            timeout: timeout || 1,
            extra: ['-i', '2'],
          });

          available = response && response.alive;
        }

        log.debug(`Pinging ${url.hostname}:${url.port || 80} - ${available ? 'successful' : 'failed'}`, camera.name);
        return available;

      } catch (error) {
        console.log('URL parse error:', error);
        log.warn(`Invalid source format: ${cameraSource}`, camera.name);
        return false;
      }

    } catch (error) {
      console.log('=== PING ERROR ===');
      console.log('Error:', error);
      console.log('Stack:', error.stack);
      return false;
    }
  }
}