import 'package:flutter/material.dart';
import 'api/api_client.dart';
import 'services/alert_controller.dart';

// Point at your running backend. Use your machine's LAN IP for a real device.
const kBaseUrl = String.fromEnvironment('API_BASE', defaultValue: 'http://10.0.2.2:4000');

void main() {
  final api = ApiClient(baseUrl: kBaseUrl);
  final controller = AlertController(api);
  controller.recover(); // flush any offline-queued alert from a prior session
  runApp(GuardianApp(controller: controller));
}

class GuardianApp extends StatelessWidget {
  const GuardianApp({super.key, required this.controller});
  final AlertController controller;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Guardian',
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: const Color(0xFFFF4D5E), brightness: Brightness.dark),
      home: HomeScreen(controller: controller),
    );
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.controller});
  final AlertController controller;
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  @override
  void initState() {
    super.initState();
    widget.controller.addListener(() => setState(() {}));
  }

  Future<void> _panic() async {
    // A real build gates this behind a press-and-hold to avoid pocket triggers,
    // and offers a cancelable countdown before it fires.
    await widget.controller.trigger();
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    final active = c.status == 'active' || c.status == 'triggering';
    return Scaffold(
      appBar: AppBar(title: const Text('Guardian')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            GestureDetector(
              onLongPress: active ? null : _panic,
              child: Container(
                width: 220, height: 220,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: active ? Colors.red.shade900 : const Color(0xFFFF4D5E),
                  boxShadow: [BoxShadow(color: const Color(0xFFFF4D5E).withOpacity(.4), blurRadius: 40, spreadRadius: 4)],
                ),
                alignment: Alignment.center,
                child: Text(
                  active ? 'ALERT\nACTIVE' : 'HOLD TO\nSEND ALERT',
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Colors.white),
                ),
              ),
            ),
            const SizedBox(height: 32),
            Text('Status: ${c.status}', style: const TextStyle(fontSize: 16)),
            if (c.alertId != null) Text('Live pings sent: ${c.pingCount}', style: const TextStyle(color: Colors.white70)),
            const SizedBox(height: 24),
            if (active)
              FilledButton.tonal(onPressed: c.resolve, child: const Text('I am safe — resolve')),
          ],
        ),
      ),
    );
  }
}
