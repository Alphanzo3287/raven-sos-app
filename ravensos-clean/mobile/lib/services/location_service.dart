import 'dart:async';
import 'package:geolocator/geolocator.dart';

/// Location capture for alerts. Two jobs:
///  1. a fast best-effort fix at trigger time (never block the alert on perfect GPS),
///  2. an adaptive stream of pings once the alert is live.
class LocationService {
  StreamSubscription<Position>? _sub;

  Future<bool> ensurePermission() async {
    if (!await Geolocator.isLocationServiceEnabled()) return false;
    var p = await Geolocator.checkPermission();
    if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
    return p == LocationPermission.always || p == LocationPermission.whileInUse;
  }

  /// Best-available fix within [timeout]. Returns whatever we have — a rough fix
  /// beats waiting. The stream corrects it seconds later.
  Future<Position?> quickFix({Duration timeout = const Duration(seconds: 4)}) async {
    try {
      return await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      ).timeout(timeout);
    } catch (_) {
      return await Geolocator.getLastKnownPosition();
    }
  }

  /// Stream pings to [onPing]. Distance filter keeps us efficient while stationary;
  /// production would also back the cadence off when speed ~0 to save battery.
  void startStreaming(void Function(Position) onPing) {
    _sub = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.bestForNavigation,
        distanceFilter: 5,
      ),
    ).listen(onPing);
  }

  void stop() {
    _sub?.cancel();
    _sub = null;
  }
}
