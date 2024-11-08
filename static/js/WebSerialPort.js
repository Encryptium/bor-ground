class WebSerialPort {
    constructor() {
        if (!("serial" in navigator)) {
            console.error("Web Serial API is not supported in this browser.");
            alert("Web Serial API is not supported in this browser. Please use Chrome or Edge on desktop.");
            return;
        }
        
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.onDataCallback = null;
    }

    async openPort() {
        try {
            // Prompt the user to select a port
            this.port = await navigator.serial.requestPort();
            await this.port.open({ baudRate: 9600 });
            
            // Set up reading and writing streams
            this.reader = this.port.readable.getReader();
            const encoder = new TextEncoderStream();
            this.writer = encoder.writable.getWriter();
            
            // Start reading incoming data
            this.readLoop();
            
            console.log("Port opened");
            return true;
        } catch (error) {
            console.error("Failed to open port:", error);
            return false;
        }
    }

    async closePort() {
        if (this.reader) {
            await this.reader.cancel();
            this.reader = null;
        }
        if (this.writer) {
            await this.writer.close();
            this.writer = null;
        }
        if (this.port) {
            await this.port.close();
            this.port = null;
        }
        console.log("Port closed");
    }

    async readLoop() {
        while (this.port && this.reader) {
            try {
                const { value, done } = await this.reader.read();
                if (done) break;
                if (value) this.onDataCallback && this.onDataCallback(new TextDecoder().decode(value));
            } catch (error) {
                console.error("Error reading data:", error);
                break;
            }
        }
    }

    sendSerial(data) {
        if (this.writer) {
            const encodedData = new TextEncoder().encode(data + "\n");
            this.writer.write(encodedData);
        }
    }

    on(event, callback) {
        if (event === "data") this.onDataCallback = callback;
    }
}
