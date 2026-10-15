import { render } from 'preact';
import { App } from './ui/App';
import { installErrorLog } from './ui/errorLog';
import './styles.css';

installErrorLog();
render(<App />, document.getElementById('app')!);
