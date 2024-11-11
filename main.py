# flask template

from flask import Flask, render_template, request, redirect, url_for
import sqlite3
import datetime
import matplotlib.pyplot as plt

app = Flask(__name__)


@app.route('/')
def index():
    return render_template('index.html')

@app.route('/track')
def track():
    return render_template('track.html')

@app.route('/api/telemetry', methods=['POST'])
def telemetry():
    data = request.json
    print(data)
    # write to file named with current timestamp
    date = datetime.date.today()
    
    # get current time formatted as [01/Nov/2024 19:40:53]
    now = datetime.now()
    formatted_time = now.strftime("[%d/%b/%Y %H:%M:%S]")


    with open('telemetry/' + date + '.txt', 'a') as f:
        f.write(formatted_time + ' ' + str(data) + '\n')

    # get data.altitude and plot it using matplotlib with time on x-axis
    altitudes = []
    times = []
    for line in open('telemetry/' + date + '.txt', 'r'):
        if 'altitude' in line:
            altitudes.append(line.split(' ')[1])
            times.append(line.split(' ')[0])

    plt.plot(times, altitudes)
    plt.xlabel('Time')
    plt.ylabel('Altitude')
    plt.title('Altitude vs Time')
    plt.savefig('static/altitude_plot.png')
    plt.close()

    # return the url of the image
    return {'url': 'static/altitude_plot.png'}


if __name__ == '__main__':
    app.run(debug=True, host='localhost', port=8080)