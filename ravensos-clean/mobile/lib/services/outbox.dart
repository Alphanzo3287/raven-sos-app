import 'dart:async';
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../api/api_client.dart';

/// The outbox is why an alert survives a dead connection. The trigger is written
/// to disk FIRST, then we try the network. If the app is killed or offline, the
/// pending alert is retried on next launch. The idempotency key guarantees the
/// server collapses duplicate retries into one alert.
class Outbox {
  Outbox(this.api);
  final ApiClient api;
  static const _key = 'guardian_pending_alert';

  Future<void> enqueueAndSend(Map<String, dynamic> payload) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(payload)); // durable first
    await _attempt(payload, prefs);
  }

  /// Call on app start to flush anything left behind by a crash/kill.
  Future<void> flushPending() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw == null) return;
    await _attempt(jsonDecode(raw) as Map<String, dynamic>, prefs);
  }

  Future<Map<String, dynamic>?> _attempt(Map<String, dynamic> p, SharedPreferences prefs) async {
    const maxRetries = 4;
    for (var attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        final res = await api.triggerAlert(
          lat: p['lat'], lng: p['lng'],
          accuracyM: p['accuracyM'], address: p['address'],
          triggerType: p['triggerType'] ?? 'manual',
          isSilent: p['isSilent'] ?? false,
          idempotencyKey: p['idempotencyKey'], // stable across retries
        );
        await prefs.remove(_key); // confirmed by server -> clear
        return res;
      } catch (_) {
        if (attempt == maxRetries) rethrow;
        await Future.delayed(Duration(milliseconds: 300 * (1 << attempt)));
      }
    }
    return null;
  }
}
