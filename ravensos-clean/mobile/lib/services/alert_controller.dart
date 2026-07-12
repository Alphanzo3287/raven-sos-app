import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import '../api/api_client.dart';
import 'location_service.dart';
import 'outbox.dart';

/// Orchestrates one alert from trigger to resolution and exposes state to the UI.
class AlertController extends ChangeNotifier {
  AlertController(this.api) : _location = LocationService(), _outbox = Outbox(api);

  final ApiClient api;
  final LocationService _location;
  final Outbox _outbox;

  String? alertId;
  String status = 'idle';
  int pingCount = 0;

  /// Fire an alert. Captures a quick fix, writes to the durable outbox, sends,
  /// then begins streaming live location. If the network is down, the outbox
  /// keeps the alert and retries; a production build ALSO fires a direct SMS
  /// fallback here (via the OS composer / a pre-authorized path) so the alert
  /// reaches guardians even with no data connection.
  Future<void> trigger({String triggerType = 'manual', bool isSilent = false}) async {
    status = 'triggering';
    notifyListeners();

    final ok = await _location.ensurePermission();
    final fix = ok ? await _location.quickFix() : null;
    final lat = fix?.latitude ?? 0.0;
    final lng = fix?.longitude ?? 0.0;

    // Stable idempotency key for THIS trigger (survives retries).
    final idem = 'trig-${DateTime.now().microsecondsSinceEpoch}';

    try {
      final res = await _outbox.enqueueAndSend({
        'lat': lat, 'lng': lng,
        'accuracyM': fix?.accuracy,
        'triggerType': triggerType, 'isSilent': isSilent,
        'idempotencyKey': idem,
      });
      alertId = res?['alert']?['id'] as String?;
      status = 'active';
      notifyListeners();
      _beginStreaming();
    } catch (e) {
      // Outbox still holds it; it'll flush on reconnect / next launch.
      status = 'queued_offline';
      notifyListeners();
      // TODO(prod): fire direct SMS fallback to guardians here.
    }
  }

  void _beginStreaming() {
    if (alertId == null) return;
    _location.startStreaming((Position pos) {
      pingCount++;
      notifyListeners();
      api.sendPing(alertId!, pos.latitude, pos.longitude,
          accuracyM: pos.accuracy, speedMps: pos.speed, headingDeg: pos.heading);
    });
  }

  Future<void> resolve() async {
    _location.stop();
    if (alertId != null) await api.resolve(alertId!, resolution: 'safe');
    status = 'resolved';
    notifyListeners();
  }

  /// Flush any alert left pending by a crash/kill on app start.
  Future<void> recover() => _outbox.flushPending();
}
