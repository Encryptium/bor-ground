from flask import Flask, render_template, request, redirect, url_for
import datetime
import matplotlib.pyplot as plt
import os

app = Flask(__name__)

# Set Matplotlib backend to 'Agg' for file-only plotting (no GUI)
plt.switch_backend('Agg')



@app.route('/')
def index():
    return render_template('index.html')

@app.route('/track')
def track():
    return render_template('track.html')

@app.route('/analyze')
def analyze():
    # count the number of files in the telemetry directory
    telemetry_files = os.listdir('telemetry')

    telemetry_events = []

    for i, file in enumerate(telemetry_files):
        # get length of file
        telemetry_events.append({"duration": len(open(f'telemetry/{file}', 'r').readlines()), "date": file.split('.')[0]})

    return render_template('records.html', events=telemetry_events)

@app.route('/analyze/<date>')
def analyze_date(date):
    data = []

    with(open(f'telemetry/{date}.txt', 'r')) as f:
        for line in f:
            timestamp = line.split(']')[0] + ']'
            data.append({"timestamp": timestamp, **eval(line.split(']')[1].strip())})

    return render_template('analyze.html', data=data)

@app.route('/api/telemetry', methods=['POST'])
def telemetry():
    data = request.json
    print(data)
    
    # Ensure the telemetry directory exists
    os.makedirs('telemetry', exist_ok=True)
    
    # Get today's date for the filename
    date = datetime.date.today().strftime("%Y-%m-%d")
    
    # Get the current time formatted as [01/Nov/2024 19:40:53]
    now = datetime.datetime.now()
    formatted_time = now.strftime("[%d/%b/%Y %H:%M:%S]")

    # Write data to a file named with today's date
    with open(f'telemetry/{date}.txt', 'a') as f:
        f.write(formatted_time + ' ' + str(data) + '\n')

    # Initialize lists for altitude and time data
    altitudes = []
    times = []
    with open(f'telemetry/{date}.txt', 'r') as f:
        for line in f:
            # Assume data is stored as '[timestamp] {"altitude": value, ...}'
            if 'altitude' in line:
                timestamp = line.split(']')[0] + ']'  # Extract timestamp
                altitude = eval(line.split(']')[1].strip()).get('altitude')  # Parse altitude from JSON
                
                if altitude is not None:
                    altitudes.append(float(altitude))
                    times.append(timestamp)

    # Set plot style for a dark theme
    plt.style.use('dark_background')

    # Set figure size for an 801x440 aspect ratio (8.01x4.4 inches at 100 DPI)
    fig, ax = plt.subplots(figsize=(8.01, 4.4))

    # Plot altitude vs time
    ax.plot(times, altitudes, color='white')  # Line color set to white
    
    # Remove the top and left spines
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)

    ax.set_xlabel('Time', color='white')         # X-axis label color set to white
    ax.set_ylabel('Altitude', color='white')     # Y-axis label color set to white
    ax.set_title('Altitude vs Time', color='white')  # Title color set to white
    ax.tick_params(axis='y', colors='white')     # Y-axis tick labels color set to white

    # Calculate the midpoint index
    mid_index = len(times) // 2

    # Only show the first, midpoint, and last timestamp on the x-axis
    ax.set_xticks([times[0], times[mid_index], times[-1]])
    ax.set_xticklabels([times[0], times[mid_index], times[-1]], rotation=15, color='white')

    # Save the plot with the specified DPI to maintain quality
    plt.tight_layout()
    plt.savefig('static/altitude_plot.png', dpi=200, transparent=True)
    plt.close()

    # Return the URL of the image
    return {'url': 'static/altitude_plot.png'}

@app.route('/api/replay', methods=['POST'])
def replay():
    data = request.json
    print(data)
    
    # Ensure the telemetry directory exists
    os.makedirs('replay_data', exist_ok=True)
    
    timestamp = data['timestamp']
    final_timestamp = data['final_timestamp']

    # Write data to a file named with today's date
    with open(f'replay_data/{data['replay_id']}.txt', 'a') as f:
        data.pop('timestamp')
        f.write(timestamp + ' ' + str(data) + '\n')

    # Initialize lists for altitude and time data
    altitudes = []
    times = []
    with open(f'replay_data/{data['replay_id']}.txt', 'r') as f:
        for line in f:
            # Assume data is stored as '[timestamp] {"altitude": value, ...}'
            if 'altitude' in line:
                timestamp = line.split(']')[0] + ']'  # Extract timestamp
                altitude = eval(line.split(']')[1].strip()).get('altitude')  # Parse altitude from JSON
                
                if altitude is not None:
                    altitudes.append(float(altitude))
                    times.append(timestamp)

    # Set plot style for a dark theme
    plt.style.use('dark_background')

    # Set figure size for an 801x440 aspect ratio (8.01x4.4 inches at 100 DPI)
    fig, ax = plt.subplots(figsize=(8.01, 4.4))

    # Plot altitude vs time
    ax.plot(times, altitudes, color='white')  # Line color set to white
    
    # Remove the top and left spines
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)

    ax.set_xlabel('Time', color='white')         # X-axis label color set to white
    ax.set_ylabel('Altitude', color='white')     # Y-axis label color set to white
    ax.set_title('Altitude vs Time', color='white')  # Title color set to white
    ax.tick_params(axis='y', colors='white')     # Y-axis tick labels color set to white

    # Calculate the midpoint index
    mid_index = len(times) // 2

    # Only show the first, midpoint, and last timestamp on the x-axis
    ax.set_xticks([times[0], times[mid_index], times[-1]])
    ax.set_xticklabels([times[0], times[mid_index], times[-1]], rotation=15, color='white')

    # Save the plot with the specified DPI to maintain quality
    plt.tight_layout()
    plt.savefig('static/altitude_plot_replay.png', dpi=200, transparent=True)
    plt.close()

    # remove temporary file after replay is done
    if timestamp[1:-1] == final_timestamp:
        os.remove(f'replay_data/{data['replay_id']}.txt')

    # Return the URL of the image
    return {'url': '/static/altitude_plot_replay.png'}


if __name__ == '__main__':
    app.run(debug=True, host='localhost', port=8080)