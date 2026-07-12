import 'dart:convert';
import 'package:http/http.dart' as http;

/// Thin client over the Guardian backend. Every call that mutates an alert is
/// idempotency-key aware so retries from the offline outbox never duplicate.
class ApiClient {
  ApiClient({required this.baseUrl, this.token});

  final String baseUrl;
  String? token;

  Map<String, String> _headers([String? idempotencyKey]) => {
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
        if (idempotencyKey != null) 'Idempotency-Key': idempotencyKey,
      };

  Future<Map<String, dynamic>> register(String displayName, String phone) async {
    final res = await http.post(
      Uri.parse('$baseUrl/api/auth/register'),
      headers: _headers(),
      body: jsonEncode({'displayName': displayName, 'phone': phone}),
    );
    final json = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode >= 400) throw ApiException(res.statusCode, json);
    token = json['token'] as String?;
    return json;
  }

  /// Fire the alert. [idempotencyKey] must be stable across retries of the SAME
  /// physical trigger so a flaky network can't create two alerts.
  Future<Map<String, dynamic>> triggerAlert({
    required double lat,
    required double lng,
    double? accuracyM,
    String? address,
    String triggerType = 'manual',
    bool isSilent = false,
    required String idempotencyKey,
  }) async {
    final res = await http.post(
      Uri.parse('$baseUrl/api/alerts'),
      headers: _headers(idempotencyKey),
      body: jsonEncode({
        'lat': lat,
        'lng': lng,
        if (accuracyM != null) 'accuracyM': accuracyM,
        if (address != null) 'address': address,
        'triggerType': triggerType,
        'isSilent': isSilent,
      }),
    );
    final json = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode >= 400) throw ApiException(res.statusCode, json);
    return json;
  }

  Future<void> sendPing(String alertId, double lat, double lng, {double? accuracyM, double? speedMps, double? headingDeg}) async {
    await http.post(
      Uri.parse('$baseUrl/api/alerts/$alertId/pings'),
      headers: _headers(),
      body: jsonEncode({
        'lat': lat, 'lng': lng,
        if (accuracyM != null) 'accuracyM': accuracyM,
        if (speedMps != null) 'speedMps': speedMps,
        if (headingDeg != null) 'headingDeg': headingDeg,
      }),
    );
  }

  Future<void> resolve(String alertId, {String resolution = 'safe'}) async {
    await http.post(
      Uri.parse('$baseUrl/api/alerts/$alertId/resolve'),
      headers: _headers(),
      body: jsonEncode({'resolution': resolution}),
    );
  }
}

class ApiException implements Exception {
  ApiException(this.status, this.body);
  final int status;
  final Map<String, dynamic> body;
  @override
  String toString() => 'ApiException($status): $body';
}
